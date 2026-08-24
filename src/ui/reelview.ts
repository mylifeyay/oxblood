import type { Strip } from '../game/reels.ts'
import { REELS, ROWS } from '../game/paylines.ts'
import { SCATTER } from '../game/symbols.ts'
import { FACE_CLASS, type SymbolFace } from './symbols.ts'
import type { MotionProfile } from './skins.ts'

/**
 * The reel display.
 *
 * Reels are decided before any of this runs — the engine hands over five stop
 * indices and this only draws the journey to them. Nothing here can change an
 * outcome, which is the point.
 *
 * Each reel keeps a floating `pos` into its strip, where pos is the strip index
 * sitting in the top visible row. Only five tiles exist per reel: one above the
 * window, the three visible rows, and one below. They are recycled every frame
 * by rewriting their symbol, so a 200-position strip costs 25 DOM nodes rather
 * than a thousand.
 */

const TILES = ROWS + 2

/** Minimum travel once stopping starts, so a reel never jerks to a halt. */
const MIN_STOP_TRAVEL = 4

/** The anticipation dip: lift, hold, then drop into the spin. */
const LIFT_MS = 60
const HOLD_MS = 80
const DIP_MS = LIFT_MS + HOLD_MS
/** How long the lift takes to fall away once the reel is turning. */
const DROP_MS = 140
/** Speed ramps up rather than starting flat out. */
const RAMP_MS = 170

/** An anticipating reel turns at a third speed. */
const ANTICIPATION_SPEED = 1 / 3

/**
 * Vertical motion blur. Four discrete levels rather than a per-frame filter
 * attribute, because switching a class is cheap and rewriting SVG filter
 * primitives sixty times a second is not. Set to false if it costs frames.
 */
const MOTION_BLUR = true
const BLUR_LEVELS = 3

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

interface Reel {
  readonly el: HTMLElement
  readonly ribbon: HTMLElement
  readonly tiles: HTMLElement[]
  readonly shown: number[]
  readonly strip: Strip
  pos: number
  phase: 'idle' | 'dip' | 'spinning' | 'stopping' | 'settling'
  /** Animated milliseconds, not wall clock — see the note in `frame`. */
  elapsed: number
  spinDuration: number
  stopFrom: number
  stopTo: number
  /** Extra pixels the ribbon is displaced by, for the dip and the overshoot. */
  lift: number
  anticipating: boolean
  slowFrom: number
  blur: number
  glowing: boolean
  lastPos: number
}

export class ReelView {
  private readonly reels: Reel[] = []
  private readonly host: HTMLElement
  private cellHeight = 0
  private running = false
  private lastFrame = 0
  private onSettled: (() => void) | null = null
  /** Fired as each reel comes to rest, for the clack. */
  onReelStop: ((index: number) => void) | null = null
  /** Fired when an anticipating reel starts and stops its slowdown. */
  onAnticipation: ((index: number, active: boolean) => void) | null = null

  private readonly faces: readonly SymbolFace[]
  private readonly motion: MotionProfile

  constructor(host: HTMLElement, strips: readonly Strip[], faces: readonly SymbolFace[], motion: MotionProfile) {
    this.host = host
    this.faces = faces
    this.motion = motion
    host.replaceChildren()

    for (let r = 0; r < REELS; r++) {
      const strip = strips[r]!
      const el = document.createElement('div')
      el.className = 'reel'

      const ribbon = document.createElement('div')
      ribbon.className = 'reel__ribbon'

      const tiles: HTMLElement[] = []
      for (let t = 0; t < TILES; t++) {
        const tile = document.createElement('div')
        tile.className = 'tile'
        const face = document.createElement('span')
        face.className = 'tile__face'
        tile.append(face)
        ribbon.append(tile)
        tiles.push(tile)
      }

      el.append(ribbon)
      host.append(el)

      this.reels.push({
        el,
        ribbon,
        tiles,
        shown: new Array<number>(TILES).fill(-1),
        strip,
        pos: Math.floor(Math.random() * strip.length),
        phase: 'idle',
        elapsed: 0,
        spinDuration: 0,
        stopFrom: 0,
        stopTo: 0,
        lift: 0,
        anticipating: false,
        slowFrom: 0,
        blur: 0,
        glowing: false,
        lastPos: 0,
      })
    }

    this.measure()
    for (const reel of this.reels) this.draw(reel)
  }

  /** Cell height comes from the laid-out DOM, so it survives any resize. */
  measure(): void {
    const first = this.reels[0]
    if (!first) return
    const height = first.el.clientHeight
    if (height <= 0) return
    this.cellHeight = height / ROWS
    this.host.style.setProperty('--cell-h', `${this.cellHeight}px`)
    for (const reel of this.reels) this.draw(reel)
  }

  get busy(): boolean {
    return this.running
  }

  /** Rows currently at rest, as strip indices. Only valid when idle. */
  restingStops(): number[] {
    return this.reels.map((r) => mod(Math.round(r.pos), r.strip.length))
  }

  /** How many scatters reel `r` will show when it stops at `stop`. */
  private scattersAt(r: number, stop: number): number {
    const strip = this.reels[r]!.strip
    let count = 0
    for (let row = 0; row < ROWS; row++) if (strip.wrapped[mod(stop, strip.length) + row] === SCATTER) count++
    return count
  }

  /**
   * Which reels get the slowdown.
   *
   * The reels are already decided; this only reads what has genuinely landed.
   * Nothing here can manufacture a near miss.
   *
   * A reel anticipates once two earlier reels have each lit a scatter. The last
   * reel only does so while the bonus is still undecided, which is the moment
   * that actually decides it — without that clause it would fire on one spin in
   * seven and stop meaning anything.
   */
  private anticipationPlan(stops: readonly number[]): boolean[] {
    const plan = new Array<boolean>(REELS).fill(false)
    let reelsLit = 0
    let scatters = 0
    for (let i = 0; i < REELS; i++) {
      const undecided = scatters < 3
      if (i >= 2 && reelsLit >= 2 && (i < REELS - 1 || undecided)) plan[i] = true
      const here = this.scattersAt(i, stops[i]!)
      if (here > 0) reelsLit++
      scatters += here
    }
    return plan
  }

  /**
   * Spins to the given stops. Resolves through `onSettled` once the last reel
   * has come to rest, which is when a win may be shown.
   */
  spinTo(stops: readonly number[], onSettled: () => void): void {
    if (this.running) return
    this.onSettled = onSettled
    const now = performance.now()
    const plan = this.anticipationPlan(stops)

    // Each reel stops after the one before it, and an anticipating reel hangs
    // on longer still, pushing everything behind it back.
    let stopAt = DIP_MS + this.motion.baseSpinMs
    this.reels.forEach((reel, i) => {
      const anticipating = plan[i]!
      if (anticipating) stopAt += this.motion.anticipationMs
      reel.phase = 'dip'
      reel.elapsed = 0
      reel.spinDuration = stopAt
      reel.anticipating = anticipating
      reel.slowFrom = stopAt - this.motion.anticipationMs
      reel.stopTo = stops[i]!
      reel.lift = 0
      stopAt += this.motion.staggerMs
    })

    this.running = true
    this.lastFrame = now
    requestAnimationFrame(this.frame)
  }

  private readonly frame = (now: number): void => {
    // Every reel advances on accumulated animation time rather than wall clock.
    // iOS pauses requestAnimationFrame whenever the app is backgrounded, and a
    // wall-clock deadline would then be long past on return — every reel would
    // hit its stop on the same frame and the stagger would vanish. Clamping the
    // delta and accumulating it means a spin interrupted by a phone call simply
    // carries on where it left off.
    const dt = Math.min(now - this.lastFrame, 50)
    this.lastFrame = now

    let active = false

    for (let i = 0; i < this.reels.length; i++) {
      const reel = this.reels[i]!

      switch (reel.phase) {
        case 'dip': {
          // Lift, hold, then drop into the spin.
          reel.elapsed += dt
          const rise = Math.min(reel.elapsed / LIFT_MS, 1)
          reel.lift = -this.motion.liftPx * easeOutCubic(rise)
          if (reel.elapsed >= DIP_MS) {
            reel.phase = 'spinning'
            reel.elapsed = DIP_MS
          }
          active = true
          break
        }

        case 'spinning': {
          reel.elapsed += dt
          const since = reel.elapsed - DIP_MS
          const ramp = Math.min(since / RAMP_MS, 1)
          const slow = reel.anticipating && reel.elapsed >= reel.slowFrom
          const speed = this.motion.spinSpeed * ramp * (slow ? ANTICIPATION_SPEED : 1)
          reel.pos -= speed * dt

          // The lift falls away as the reel gets going.
          reel.lift = -this.motion.liftPx * Math.max(0, 1 - since / DROP_MS)

          if (slow !== reel.glowing) {
            reel.glowing = slow
            reel.el.classList.toggle('is-anticipating', slow)
            if (slow) this.onAnticipation?.(i, true)
          }

          if (reel.elapsed >= reel.spinDuration) {
            // Land on the first strip position congruent to the target that is
            // still at least MIN_STOP_TRAVEL away, so the stop always has travel.
            const distance = mod(reel.pos - reel.stopTo, reel.strip.length)
            const travel = distance < MIN_STOP_TRAVEL ? distance + reel.strip.length : distance
            reel.stopFrom = reel.pos
            // Overshoot past the resting position, to be snapped back.
            reel.stopTo = reel.pos - travel - this.overshootUnits()
            reel.elapsed = 0
            reel.phase = 'stopping'
          }
          active = true
          break
        }

        case 'stopping': {
          reel.elapsed += dt
          const t = Math.min(reel.elapsed / this.motion.stopMs, 1)
          reel.pos = reel.stopFrom + (reel.stopTo - reel.stopFrom) * easeOutCubic(t)
          reel.lift = 0
          if (t >= 1) {
            reel.phase = 'settling'
            reel.elapsed = 0
            reel.stopFrom = reel.pos
            reel.stopTo = reel.stopTo + this.overshootUnits()
            if (reel.glowing) {
              reel.glowing = false
              reel.el.classList.remove('is-anticipating')
              this.onAnticipation?.(i, false)
            }
            this.onReelStop?.(i)
          }
          active = true
          break
        }

        case 'settling': {
          // The snap back from the overshoot.
          reel.elapsed += dt
          const t = Math.min(reel.elapsed / this.motion.settleMs, 1)
          reel.pos = reel.stopFrom + (reel.stopTo - reel.stopFrom) * easeOutCubic(t)
          if (t >= 1) {
            // stopTo is an exact strip index in theory, but it is arrived at
            // through float arithmetic and lands a hair either side. Snap it, so
            // a resting reel is always flush and restingStops() is exact.
            reel.pos = mod(Math.round(reel.stopTo), reel.strip.length)
            reel.phase = 'idle'
          } else {
            active = true
          }
          break
        }

        case 'idle':
          break
      }

      this.draw(reel)
    }

    if (active) {
      requestAnimationFrame(this.frame)
      return
    }

    this.running = false
    const settled = this.onSettled
    this.onSettled = null
    settled?.()
  }

  private overshootUnits(): number {
    return this.cellHeight > 0 ? this.motion.overshootPx / this.cellHeight : 0
  }

  private draw(reel: Reel): void {
    const base = Math.floor(reel.pos)
    const frac = reel.pos - base
    reel.ribbon.style.transform = `translate3d(0, ${-(1 + frac) * this.cellHeight + reel.lift}px, 0)`

    if (MOTION_BLUR) {
      // Blur tracks speed, in steps, so the class only changes a few times a spin.
      const speed = reel.phase === 'spinning' || reel.phase === 'stopping' ? Math.abs(reel.pos - reel.lastPos) : 0
      const level = speed <= 0.08 ? 0 : Math.min(BLUR_LEVELS, Math.ceil(speed / 0.16))
      if (level !== reel.blur) {
        if (reel.blur) reel.ribbon.classList.remove(`is-blur-${reel.blur}`)
        if (level) reel.ribbon.classList.add(`is-blur-${level}`)
        reel.blur = level
      }
    }
    reel.lastPos = reel.pos

    for (let t = 0; t < TILES; t++) {
      const symbol = reel.strip.symbols[mod(base + t - 1, reel.strip.length)]!
      if (reel.shown[t] === symbol) continue
      reel.shown[t] = symbol

      const tile = reel.tiles[t]!
      const face = this.faces[symbol]!
      tile.className = `tile tile--${FACE_CLASS[symbol]} tile--${face.kind}`
      tile.firstElementChild!.textContent = face.glyph
    }
  }

  /** Pixel box of one grid cell, relative to the reel host. */
  cellBox(reel: number, row: number): { x: number; y: number; w: number; h: number } {
    const el = this.reels[reel]!.el
    return { x: el.offsetLeft, y: el.offsetTop + row * this.cellHeight, w: el.offsetWidth, h: this.cellHeight }
  }
}
