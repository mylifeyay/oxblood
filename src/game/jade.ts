import { L1, L2, L3, L4, M1, M2, WILD, SCATTER, COIN, SYMBOL_COUNT } from './symbols.ts'
import type { GameConfig, ReelWeights } from './config.ts'

const w = (l1: number, l2: number, l3: number, l4: number, m1: number, m2: number, wild: number, scatter: number, coin = 0): ReelWeights => {
  const out = new Array<number>(SYMBOL_COUNT).fill(0)
  out[L1] = l1
  out[L2] = l2
  out[L3] = l3
  out[L4] = l4
  out[M1] = m1
  out[M2] = m2
  out[WILD] = wild
  out[SCATTER] = scatter
  out[COIN] = coin
  return out
}

/**
 * Jade Parlour.
 *
 * Two hundred and forty-three ways rather than ten lines, which changes the
 * texture completely: wins land on most spins and are usually small, and the
 * good ones come from a symbol stacking several deep across the reels. Wilds
 * substitute but never pay on their own, so a wild is only ever worth what it
 * is standing in for.
 *
 * Bet is twenty-five a unit rather than ten. It is the room you graduate to.
 *
 * The bonus is untouched: three, four or five scatters still pay 5x, 20x and
 * 100x the bet and still play a clip.
 */
export const JADE_CONFIG: GameConfig = {
  evaluation: 'ways',
  rows: 3,
  betPerLine: 1,
  lineCount: 25,
  totalBet: 25,
  betLevels: [1, 2, 5, 10, 25],

  // Fewer wilds and a flatter symbol spread than Oxblood: with 243 ways, a
  // generous reel makes every spin a win and nothing feels like anything.
  reels: [
    //          L1  L2  L3  L4  M1  M2   W  SC  COIN
    { weights: w(35, 33, 30, 28, 20, 14, 8, 10, 22), scatterPairs: 3 },
    { weights: w(35, 33, 30, 28, 20, 14, 8, 10, 22), scatterPairs: 3 },
    { weights: w(35, 33, 30, 28, 20, 14, 8, 10, 22), scatterPairs: 3 },
    { weights: w(39, 35, 32, 30, 20, 14, 0, 8, 22), scatterPairs: 1 },
    { weights: w(39, 37, 34, 30, 20, 10, 0, 8, 22), scatterPairs: 1 },
  ],

  // Retuned once hold and spin arrived: the lanterns take a fifth of the
  // machine's return, and the reels give up their share to pay for it.
  paytable: (() => {
    const t: number[][] = new Array(SYMBOL_COUNT).fill(null).map(() => [0, 0, 0])
    t[L1] = [1, 5, 15]
    t[L2] = [1, 5, 15]
    t[L3] = [3, 10, 26]
    t[L4] = [3, 10, 26]
    t[M1] = [5, 26, 106]
    t[M2] = [10, 41, 157]
    t[WILD] = [0, 0, 0] // substitutes only
    t[SCATTER] = [0, 0, 0]
    return t
  })(),

  tiers: [
    { name: 'mini', scatters: 3, payMultiple: 4 },
    { name: 'minor', scatters: 4, payMultiple: 20 },
    { name: 'major', scatters: 5, payMultiple: 100 },
  ],

  // Six lanterns lock the board and the respins fill it in. Values are
  // multiples of the total bet, so the feature scales with the stake exactly
  // as the bonus tiers do.
  hold: {
    triggerCount: 6,
    respins: 3,
    values: [
      { multiple: 1, weight: 40 },
      { multiple: 2, weight: 25 },
      { multiple: 3, weight: 15 },
      { multiple: 5, weight: 10 },
      { multiple: 10, weight: 6 },
      { multiple: 25, weight: 3 },
      { multiple: 50, weight: 1 },
    ],
    landChance: 0.055,
    fullBoardMultiple: 100,
  },

  pitySpins: 30,
  cooldownSpins: 3,
  stripSeed: 0x3ade1,
}
