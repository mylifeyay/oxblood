import { FREE } from './symbols.ts'
import type { GameConfig } from './config.ts'

/**
 * Free spins with a climbing multiplier.
 *
 * The feature is bought by the free scatter, not the paying one, so a cabinet
 * can run both: one scatter hands over credits and a clip, the other hands over
 * spins. Every free spin that pays anything ratchets the multiplier one step,
 * and the multiplier never falls back inside the round — which is the whole
 * point of it. A run that keeps hitting is worth far more at the end than at
 * the start.
 *
 * Landing the trigger again mid-round adds spins without touching the
 * multiplier, so a retrigger extends a snowball rather than restarting one.
 *
 * The paying scatter sits the round out. Two clips back to back cheapen both,
 * and the cabinet's cooldown only counts paid spins — so rather than let a
 * round quietly break that guarantee, the tiers are simply not in play here.
 */
export interface FreeConfig {
  /** Free scatters needed on screen, in the base game and to retrigger. */
  readonly trigger: number
  /** Spins awarded when it triggers. */
  readonly spins: number
  /** Spins added when the trigger lands again during the round. */
  readonly retrigger: number
  /**
   * How far the multiplier can climb. Uncapped, one long hot round carries an
   * unreasonable share of the machine's whole return, and the tail gets wider
   * than the credit meter can usefully show.
   */
  readonly multiplierCap: number
}

/** One spin inside the round, kept whole so the presentation can replay it. */
export interface FreeSpin {
  readonly stops: number[]
  readonly grid: Int8Array
  /** Reel win before the multiplier. */
  readonly basePay: number
  /** What this spin's reel win was multiplied by. */
  readonly multiplier: number
  /** Reel win after the multiplier. */
  readonly pay: number
  readonly frees: number
  /** Spins added by a retrigger on this spin. */
  readonly added: number
  /** Spins still to come after this one. */
  readonly spinsLeft: number
}

export interface FreeResult {
  readonly spins: FreeSpin[]
  /** Everything the round paid. */
  readonly total: number
  /** Where the multiplier finished. */
  readonly finalMultiplier: number
  /** Spins played, including any added by retriggers. */
  readonly played: number
  /** Spins added by retriggers. */
  readonly retriggers: number
}

/** How many free scatters are on a screen. */
export function countFrees(grid: Int8Array): number {
  let n = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] === FREE) n++
  return n
}

/** True when a screen has bought a round. */
export function triggersFree(config: GameConfig, grid: Int8Array): boolean {
  const free = config.free
  return free !== undefined && countFrees(grid) >= free.trigger
}

/**
 * Runs a whole round.
 *
 * `spin` is handed in rather than reached for: the caller owns the reels, the
 * pity timer and the cooldown, and this only decides what a round is worth once
 * those have had their say. That keeps the feature exactly as simulable as the
 * base game — the tuner calls it with the same reels the cabinet ships.
 */
export function resolveFree(
  config: GameConfig,
  spin: () => FreeSpinDraw,
): FreeResult | null {
  const cfg = config.free
  if (!cfg) return null

  const spins: FreeSpin[] = []
  let left = cfg.spins
  let multiplier = 1
  let total = 0
  let retriggers = 0
  let played = 0

  while (left > 0) {
    left--
    played++
    const draw = spin()
    const frees = countFrees(draw.grid)
    const added = frees >= cfg.trigger ? cfg.retrigger : 0
    if (added > 0) {
      left += added
      retriggers += added
    }

    const pay = draw.basePay * multiplier
    total += pay

    spins.push({
      stops: draw.stops,
      grid: draw.grid,
      basePay: draw.basePay,
      multiplier,
      pay,
      frees,
      added,
      spinsLeft: left,
    })

    // The ratchet. A spin that paid nothing leaves the multiplier where it is,
    // so a cold streak costs progress rather than undoing it.
    if (draw.basePay > 0 && multiplier < cfg.multiplierCap) multiplier++
  }

  return { spins, total, finalMultiplier: multiplier, played, retriggers }
}

/** What the caller must produce for each free spin. */
export interface FreeSpinDraw {
  readonly stops: number[]
  readonly grid: Int8Array
  readonly basePay: number
}
