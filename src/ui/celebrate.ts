export type WinTier = 'none' | 'small' | 'medium' | 'big'

/** Small under 5x the bet, medium to 20x, big above that. */
export function winTierFor(payout: number, bet: number): WinTier {
  if (payout <= 0) return 'none'
  const multiple = payout / bet
  if (multiple < 5) return 'small'
  if (multiple <= 20) return 'medium'
  return 'big'
}

export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  colour: string
}

const COLOURS = ['#FFB443', '#C89B3F', '#F2E8DA']

/**
 * The particle burst. One canvas over the reel window, sized to it, running
 * only while there is something alive to draw.
 */
export class Particles {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly items: Particle[] = []
  private running = false
  private last = 0

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'particles'
    host.append(this.canvas)
    this.ctx = this.canvas.getContext('2d')
    this.resize()
  }

  resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect()
    if (!rect) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr))
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr))
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  burst(x: number, y: number, count = 14): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 40 + Math.random() * 170
      const max = 620 + Math.random() * 520
      this.items.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 90,
        life: 0,
        max,
        size: 1.6 + Math.random() * 2.6,
        colour: COLOURS[Math.floor(Math.random() * COLOURS.length)]!,
      })
    }
    this.start()
  }

  private start(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    requestAnimationFrame(this.frame)
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(now - this.last, 50)
    this.last = now
    const ctx = this.ctx
    if (!ctx) {
      this.running = false
      return
    }

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]!
      p.life += dt
      if (p.life >= p.max) {
        this.items.splice(i, 1)
        continue
      }
      const seconds = dt / 1000
      p.vy += 620 * seconds
      p.x += p.vx * seconds
      p.y += p.vy * seconds

      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max)
      ctx.fillStyle = p.colour
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    if (this.items.length > 0) {
      requestAnimationFrame(this.frame)
    } else {
      this.running = false
    }
  }

  clear(): void {
    this.items.length = 0
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }
}

/**
 * The big-win takeover. Everything else stops and the panel holds the screen
 * while the amount climbs.
 */
export class BigWin {
  private readonly root: HTMLDivElement
  private readonly title: HTMLDivElement
  private readonly amount: HTMLDivElement

  constructor(host: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'bigwin'
    this.root.hidden = true

    this.title = document.createElement('div')
    this.title.className = 'bigwin__title'
    this.title.textContent = 'Big win'

    this.amount = document.createElement('div')
    this.amount.className = 'bigwin__amount'

    this.root.append(this.title, this.amount)
    host.append(this.root)
  }

  /** Shows the panel and climbs to `payout` over `ms`. */
  async show(payout: number, ms: number, onTick: (progress: number) => void, title = 'Big win'): Promise<void> {
    this.title.textContent = title
    this.root.classList.toggle('is-jackpot', title !== 'Big win')
    this.amount.textContent = '0'
    this.root.hidden = false
    void this.root.offsetHeight
    this.root.classList.add('is-in')

    await new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(safety)
        this.amount.textContent = String(payout)
        resolve()
      }
      const ticks = Math.max(1, Math.round((ms / 1000) * 12))
      let lastTick = -1
      const started = performance.now()
      const step = (now: number): void => {
        const t = Math.min((now - started) / ms, 1)
        // Linear rather than eased: a big win should climb steadily, not sprint
        // and then crawl.
        this.amount.textContent = String(Math.round(payout * t))
        const tick = Math.floor(t * ticks)
        if (tick !== lastTick) {
          lastTick = tick
          onTick(t)
        }
        if (t < 1) requestAnimationFrame(step)
        else finish()
      }
      const safety = setTimeout(finish, ms * 2 + 2000)
      requestAnimationFrame(step)
    })
  }

  async hide(): Promise<void> {
    this.root.classList.remove('is-in')
    await new Promise((resolve) => setTimeout(resolve, 240))
    this.root.hidden = true
  }
}
