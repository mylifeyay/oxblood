import { tierPay, type BonusTier, type GameConfig } from './config.ts'

import { buildStrips, type Strip } from './reels.ts'
import { countScatters, evaluateDetail, evaluateTotal, type LineWin } from './evaluate.ts'
import { mulberry32, type Rng } from './random.ts'
import { countCoins, resolveHold, type HoldResult } from './hold.ts'

const MAX_REROLLS = 20000
const COUNTER_CAP = 1e9

export interface SpinSnapshot {
  readonly stops: number[]
  readonly grid: Int8Array
  readonly linePayout: number
  readonly lineWins: LineWin[]
  readonly scatters: number
  readonly tier: BonusTier | null
  readonly bonusPayout: number
  readonly totalPayout: number
  readonly pityForced: boolean
  readonly cooldownBlocked: boolean
  readonly jackpotPayout: number
  readonly hold: HoldResult | null
  readonly holdPayout: number
}

/**
 * The spin engine. Everything about an outcome is settled here, before any
 * animation starts — the presentation only draws out what already landed.
 *
 * Two rules bend the raw odds, and both do it by re-rolling the whole spin
 * rather than by nudging individual reels. Re-rolling keeps every screen a
 * genuine draw from the strips: a forced Mini is indistinguishable from a
 * natural one, because it *is* a natural one, just selected for.
 */
export class SlotMachine {
  readonly config: GameConfig
  readonly strips: readonly Strip[]

  readonly stops: Int32Array
  readonly grid: Int8Array

  linePayout = 0
  scatterCount = 0
  tier: BonusTier | null = null
  bonusPayout = 0
  totalPayout = 0
  pityForced = false
  cooldownBlocked = false
  /** Credits in the pot right now. Zero on machines without a progressive. */
  jackpot = 0
  /** What this spin won from the pot, if anything. */
  jackpotPayout = 0
  /** The hold and spin feature, when this spin started one. */
  hold: HoldResult | null = null
  holdPayout = 0

  private readonly rng: Rng
  private betPerLineValue: number
  private spinsSinceMini = 0
  private spinsSinceBonus = COUNTER_CAP

  constructor(config: GameConfig, seed: number = (Math.random() * 0xffffffff) >>> 0) {
    this.config = config
    this.strips = buildStrips(config)
    this.rng = mulberry32(seed)
    this.betPerLineValue = config.betPerLine
    this.stops = new Int32Array(config.reels.length)
    this.grid = new Int8Array(config.reels.length * config.rows)
    this.jackpot = this.seedJackpot
  }

  /**
   * Puts the pity timer and cooldown back where a previous session left them.
   * Without this a reload would reset the drought clock, and the guarantee that
   * a Mini never takes more than pitySpins + cooldownSpins would only hold
   * within one sitting.
   */
  restore(sinceMini: number, sinceBonus: number): void {
    this.spinsSinceMini = Math.max(0, Math.min(sinceMini, COUNTER_CAP))
    this.spinsSinceBonus = Math.max(0, Math.min(sinceBonus, COUNTER_CAP))
  }

  get betPerLine(): number {
    return this.betPerLineValue
  }

  set betPerLine(value: number) {
    this.betPerLineValue = value
  }

  get totalBet(): number {
    return this.betPerLineValue * this.config.lineCount
  }

  /** The pot's restart value, in credits. */
  get seedJackpot(): number {
    const p = this.config.progressive
    return p ? p.seedMultiple * this.config.totalBet : 0
  }

  /** Puts a saved pot back. */
  restoreJackpot(value: number): void {
    if (this.config.progressive) this.jackpot = Math.max(this.seedJackpot, value)
  }

  get sinceMini(): number {
    return this.spinsSinceMini
  }

  get sinceBonus(): number {
    return this.spinsSinceBonus
  }

  /** How many lanterns are on the screen as rolled. */
  get coinCount(): number {
    return countCoins(this.grid)
  }

  /** The lowest scatter count that pays anything. */
  private get minBonusScatters(): number {
    return this.config.tiers[0]!.scatters
  }

  private tierFor(scatters: number): BonusTier | null {
    let found: BonusTier | null = null
    for (const tier of this.config.tiers) if (scatters >= tier.scatters) found = tier
    return found
  }

  /** One honest draw: random stop per reel, window read into the grid. */
  private roll(): void {
    const rows = this.config.rows
    for (let reel = 0; reel < this.strips.length; reel++) {
      const strip = this.strips[reel]!
      const stop = Math.floor(this.rng() * strip.length)
      this.stops[reel] = stop
      for (let row = 0; row < rows; row++) this.grid[reel * rows + row] = strip.wrapped[stop + row]!
    }
    this.scatterCount = countScatters(this.grid)
  }

  /** Re-rolls until the scatter count satisfies `accept`. */
  private rollUntil(accept: (scatters: number) => boolean, why: string): void {
    for (let attempt = 0; attempt < MAX_REROLLS; attempt++) {
      this.roll()
      if (accept(this.scatterCount)) return
    }
    throw new Error(`could not find a spin where ${why} after ${MAX_REROLLS} rolls — check the scatter weights`)
  }

  /**
   * Advances one spin. Read the public fields afterwards, or call snapshot().
   * Nothing is allocated, which is what makes ten million spins cheap.
   */
  next(): void {
    const inCooldown = this.spinsSinceBonus < this.config.cooldownSpins
    const owedPity = this.spinsSinceMini >= this.config.pitySpins

    this.pityForced = false
    this.cooldownBlocked = false

    if (inCooldown) {
      // The cooldown is absolute. Two clips back to back cheapens both, so it
      // outranks the pity timer, which simply fires on the next eligible spin.
      this.cooldownBlocked = true
      this.rollUntil((s) => s < this.minBonusScatters, 'no bonus lands')
    } else if (owedPity) {
      this.pityForced = true
      this.rollUntil((s) => s === this.minBonusScatters, 'exactly a Mini lands')
    } else {
      this.roll()
    }

    // Hold and spin is decided here with the rest of the spin, before a frame
    // is drawn — the presentation only replays the rounds it is handed.
    this.hold = this.config.hold ? resolveHold(this.config, this.totalBet, this.grid, this.rng) : null
    this.holdPayout = this.hold?.payout ?? 0

    // The pot takes its cut of the wager whether or not this spin pays.
    const progressive = this.config.progressive
    this.jackpotPayout = 0
    if (progressive) {
      this.jackpot += progressive.contribution * this.totalBet
      if (this.scatterCount >= progressive.triggerScatters) {
        this.jackpotPayout = Math.round(this.jackpot)
        this.jackpot = this.seedJackpot
      }
    }

    this.tier = this.tierFor(this.scatterCount)
    this.bonusPayout = this.tier ? tierPay(this.tier, this.totalBet) : 0
    this.linePayout = evaluateTotal(this.grid, this.config, this.betPerLineValue)
    this.totalPayout = this.linePayout + this.bonusPayout + this.jackpotPayout + this.holdPayout

    if (this.tier?.name === 'mini') this.spinsSinceMini = 0
    else this.spinsSinceMini = Math.min(this.spinsSinceMini + 1, COUNTER_CAP)

    if (this.tier) this.spinsSinceBonus = 0
    else this.spinsSinceBonus = Math.min(this.spinsSinceBonus + 1, COUNTER_CAP)
  }

  /** A plain object copy of the last spin, for the parts that are not hot. */
  snapshot(): SpinSnapshot {
    const { total, wins } = evaluateDetail(this.grid, this.config, this.betPerLineValue)
    return {
      stops: Array.from(this.stops),
      grid: this.grid.slice(),
      linePayout: total,
      lineWins: wins,
      scatters: this.scatterCount,
      tier: this.tier,
      bonusPayout: this.bonusPayout,
      totalPayout: this.totalPayout,
      pityForced: this.pityForced,
      cooldownBlocked: this.cooldownBlocked,
      jackpotPayout: this.jackpotPayout,
      hold: this.hold,
      holdPayout: this.holdPayout,
    }
  }
}
