import { L1, L2, L3, L4, M1, M2, WILD, SCATTER, SYMBOL_COUNT } from './symbols.ts'

/** Weights are symbol counts on that reel's strip, indexed by symbol id. */
export type ReelWeights = readonly number[]

export interface ReelSpec {
  readonly weights: ReelWeights
  /**
   * How many of this reel's SCATTER symbols sit as adjacent pairs rather than
   * on their own. A pair can show two scatters in one window, which fattens
   * the tail of the scatter count — the only way to make five-scatter Majors
   * reachable without making three-scatter Minis far too common. See
   * docs/math.md for why.
   */
  readonly scatterPairs: number
}

export interface BonusTier {
  readonly name: 'mini' | 'minor' | 'major'
  readonly scatters: number
  /**
   * Paid as a multiple of the total bet, not a flat number of credits. Fixed
   * credits would mean raising the bet cut the return: at ten a spin the Mini
   * is 5x the bet, at a hundred a spin it would be half of one. As a multiple,
   * RTP is identical at every bet level.
   */
  readonly payMultiple: number
}

/**
 * How a screen is scored.
 *
 * `lines` pays fixed paylines. `ways` pays any symbol appearing on consecutive
 * reels from reel 1, multiplying the number of places it appears on each —
 * five reels of three rows gives 243 ways.
 */
export type Evaluation = 'lines' | 'ways'

export interface GameConfig {
  readonly evaluation: Evaluation
  /** Bet per line at the default level. */
  readonly betPerLine: number
  /** Paylines when scoring by lines; bet units when scoring by ways. */
  readonly lineCount: number
  /** Total bet at the default level. */
  readonly totalBet: number
  /** Selectable bet-per-line values, cycled by tapping the bet meter. */
  readonly betLevels: readonly number[]
  readonly reels: readonly ReelSpec[]
  /** Payout per symbol for a run of 3, 4 and 5, in multiples of bet-per-line. */
  readonly paytable: readonly (readonly [number, number, number])[]
  readonly tiers: readonly BonusTier[]
  /** Spins without a Mini before the next spin is forced to land one. */
  readonly pitySpins: number
  /** No bonus may trigger within this many spins of the previous one. */
  readonly cooldownSpins: number
  /** Fixed seed so the strips are identical in the game and the simulator. */
  readonly stripSeed: number
}

const w = (l1: number, l2: number, l3: number, l4: number, m1: number, m2: number, wild: number, scatter: number): ReelWeights => {
  const out = new Array<number>(SYMBOL_COUNT).fill(0)
  out[L1] = l1
  out[L2] = l2
  out[L3] = l3
  out[L4] = l4
  out[M1] = m1
  out[M2] = m2
  out[WILD] = wild
  out[SCATTER] = scatter
  return out
}

export const CONFIG: GameConfig = {
  evaluation: 'lines',
  betPerLine: 1,
  lineCount: 10,
  totalBet: 10,
  betLevels: [1, 2, 5, 10, 25],

  // Counts on a 200-position strip. Two hundred rather than a hundred because
  // the scatter tiers need finer than 1% granularity to land on target.
  // Divide by two to read these as the percentages in the brief.
  reels: [
    //          L1  L2  L3  L4  M1  M2   W  SC
    { weights: w(35, 35, 32, 32, 24, 20, 12, 10), scatterPairs: 3 },
    { weights: w(35, 35, 32, 32, 24, 20, 12, 10), scatterPairs: 3 },
    { weights: w(35, 35, 32, 32, 24, 20, 12, 10), scatterPairs: 3 },
    { weights: w(39, 35, 35, 31, 24, 20, 8, 8), scatterPairs: 1 },
    { weights: w(39, 39, 35, 31, 24, 16, 8, 8), scatterPairs: 1 },
  ],

  // Payout for a run of 3, 4 and 5, in multiples of bet-per-line.
  //
  // The brief's table (L 0.5/2/10, M 1/5/25, WILD 2/10/200) keeps its shape
  // here but is scaled up 6.3x. As written it returned 7.7% RTP against a plan
  // that needs lines to supply ~48%, so it could not reach its own target.
  // Whole numbers only: the credit meter ticks in whole credits.
  paytable: (() => {
    const t: [number, number, number][] = new Array(SYMBOL_COUNT).fill(null).map(() => [0, 0, 0] as [number, number, number])
    t[L1] = [3, 12, 70]
    t[L2] = [3, 12, 70]
    t[L3] = [3, 12, 70]
    t[L4] = [3, 12, 70]
    t[M1] = [6, 30, 170]
    t[M2] = [6, 30, 170]
    t[WILD] = [15, 70, 1250]
    t[SCATTER] = [0, 0, 0] // scatters pay through the bonus tiers, never on lines
    return t
  })(),

  // 5x, 20x and 100x the total bet — which is 50, 200 and 1000 at the default
  // bet of ten, exactly as the maths was tuned.
  tiers: [
    { name: 'mini', scatters: 3, payMultiple: 5 },
    { name: 'minor', scatters: 4, payMultiple: 20 },
    { name: 'major', scatters: 5, payMultiple: 100 },
  ],

  pitySpins: 40,
  cooldownSpins: 4,
  stripSeed: 0x5c1a7,
}

/** What a tier pays at a given total bet. */
export const tierPay = (tier: BonusTier, totalBet: number): number => tier.payMultiple * totalBet
