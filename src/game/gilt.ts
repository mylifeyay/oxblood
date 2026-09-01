import { L1, L2, L3, L4, M1, M2, WILD, SCATTER, FREE, SYMBOL_COUNT } from './symbols.ts'
import type { GameConfig, ReelWeights } from './config.ts'

const w = (
  l1: number, l2: number, l3: number, l4: number,
  m1: number, m2: number, wild: number, scatter: number, free: number,
): ReelWeights => {
  const out = new Array<number>(SYMBOL_COUNT).fill(0)
  out[L1] = l1
  out[L2] = l2
  out[L3] = l3
  out[L4] = l4
  out[M1] = m1
  out[M2] = m2
  out[WILD] = wild
  out[SCATTER] = scatter
  out[FREE] = free
  return out
}

/**
 * Gilt Vault.
 *
 * Three reels, three rows, twenty-seven ways — and with only three reels there
 * is no such thing as a near miss. Every spin either completes or it does not,
 * which makes it the quickest cabinet in the place to read.
 *
 * Two scatters run here, which is what the room is for. The burst pays the
 * tiers and plays a clip, exactly as it does everywhere else. The vault buys
 * free spins instead, and inside those the multiplier climbs a step on every
 * spin that pays and never falls back — so a round that keeps hitting is worth
 * several times at the end what it was worth at the start. Land three vaults
 * again mid-round and the spins are topped up without disturbing the climb.
 */
export const GILT_CONFIG: GameConfig = {
  evaluation: 'ways',
  rows: 3,
  betPerLine: 1,
  lineCount: 50,
  totalBet: 50,
  betLevels: [1, 2, 5, 10, 25],

  // The third reel is the mean one, as it is on every three-reel machine:
  // fewer wilds and fewer of the top symbol, so the last plate to stop is the
  // one that most often refuses.
  //          L1  L2  L3  L4  M1  M2   W  SC  FR
  reels: [
    { weights: w(35, 33, 30, 26, 20, 14, 13, 20, 9), scatterPairs: 4 },
    { weights: w(35, 33, 30, 26, 20, 14, 13, 20, 9), scatterPairs: 4 },
    { weights: w(37, 35, 31, 28, 20, 12, 8, 20, 9), scatterPairs: 4 },
  ],

  // Three reels means one column: a run is three or it is nothing. The pays are
  // large next to the other cabinets because there is only one of them — no
  // four-of-a-kind to build towards, so all the money sits on the single rung.
  paytable: (() => {
    const t: number[][] = new Array(SYMBOL_COUNT).fill(null).map(() => [0])
    t[L1] = [6]
    t[L2] = [6]
    t[L3] = [16]
    t[L4] = [16]
    t[M1] = [41]
    t[M2] = [112]
    t[WILD] = [0] // substitutes only
    t[SCATTER] = [0]
    t[FREE] = [0]
    return t
  })(),

  tiers: [
    { name: 'mini', scatters: 3, payMultiple: 4 },
    { name: 'minor', scatters: 4, payMultiple: 20 },
    { name: 'major', scatters: 5, payMultiple: 100 },
  ],

  free: {
    trigger: 3,
    spins: 8,
    retrigger: 5,
    multiplierCap: 10,
  },

  pitySpins: 30,
  cooldownSpins: 3,
  stripSeed: 0x9117,
}
