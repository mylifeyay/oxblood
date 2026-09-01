import { L1, L2, L3, L4, M1, M2, WILD, SCATTER, SYMBOL_COUNT } from './symbols.ts'
import type { GameConfig, ReelWeights } from './config.ts'

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

/**
 * Ember Room.
 *
 * Six reels, four rows: 4^6 = 4096 ways, the biggest board in the building.
 * Wins land constantly and most are pennies; the reason to be here is the pot.
 *
 * Every wager puts two per cent of itself into a jackpot that keeps climbing
 * until six scatters land, which is also a Major — so the biggest hit on the
 * machine pays the tier, plays a Legendary clip, and empties the pot at once.
 *
 * The base game is tuned below 94% on purpose. The pot gives back what it takes
 * plus the seed it restarts from, and the total is what has to land on target.
 */
export const EMBER_CONFIG: GameConfig = {
  evaluation: 'ways',
  rows: 4,
  betPerLine: 1,
  lineCount: 50,
  totalBet: 50,
  betLevels: [1, 2, 5, 10, 25],

  // Six reels of four rows is a lot of chances, so the reels are lean. Scatters
  // thin out sharply towards the back: six of them has to stay a rare thing.
  reels: [
    //          L1  L2  L3  L4  M1  M2   W  SC
    { weights: w(45, 41, 37, 33, 19, 11, 6, 8), scatterPairs: 0 },
    { weights: w(45, 41, 37, 33, 19, 11, 6, 8), scatterPairs: 0 },
    { weights: w(45, 41, 37, 33, 19, 11, 6, 8), scatterPairs: 0 },
    { weights: w(49, 43, 39, 35, 20, 10, 0, 4), scatterPairs: 2 },
    { weights: w(51, 45, 41, 35, 17, 8, 0, 4), scatterPairs: 2 },
    { weights: w(54, 47, 43, 37, 15, 6, 0, 3), scatterPairs: 1 },
  ],

  // Tuned by scripts/tune-ember.ts against the six-of-a-kind column.
  paytable: (() => {
    const t: number[][] = new Array(SYMBOL_COUNT).fill(null).map(() => [0, 0, 0, 0])
    // Four thousand ways means three of a kind lands constantly, so the low
    // symbols do not pay for it at all — they start at four. Six of a kind is
    // where the board's size shows up in the numbers.
    //           3   4    5    6
    t[L1] = [0, 2, 4, 6]
    t[L2] = [0, 2, 4, 6]
    t[L3] = [0, 2, 6, 16]
    t[L4] = [0, 2, 6, 16]
    t[M1] = [2, 10, 41, 102]
    t[M2] = [5, 21, 102, 303]
    t[WILD] = [0, 0, 0] // substitutes only
    t[SCATTER] = [0, 0, 0]
    return t
  })(),

  tiers: [
    { name: 'mini', scatters: 3, payMultiple: 4 },
    { name: 'minor', scatters: 4, payMultiple: 20 },
    { name: 'major', scatters: 5, payMultiple: 100 },
  ],

  progressive: {
    contribution: 0.02,
    seedMultiple: 40,
    triggerScatters: 6,
  },

  pitySpins: 30,
  cooldownSpins: 3,
  stripSeed: 0xe4be7,
}
