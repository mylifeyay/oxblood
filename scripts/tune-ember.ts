/**
 * Finds Ember Room's scatter weights.
 *
 * Six reels of four rows makes scatters far easier to land than on a five by
 * three board, so the weights have to come down hard and thin out towards the
 * back. Four things have to land at once: the three bonus tiers and the
 * jackpot at six. Closed form does the searching, as before.
 */
import { EMBER_CONFIG } from '../src/game/ember.ts'
import { SCATTER, SYMBOL_COUNT, L1, L2, L3, L4, M1, M2, WILD } from '../src/game/symbols.ts'
import type { GameConfig, ReelSpec } from '../src/game/config.ts'
import { scatterCountDistribution } from '../src/game/analysis.ts'

const STRIP = 200
const ROWS = EMBER_CONFIG.rows

const TARGET = { mini: 25, minor: 150, major: 800, jackpot: 6000 }

/** Non-scatter proportions, preserved as ratios while scatters take their share. */
const RATIOS: readonly number[][] = [
  [46, 42, 38, 34, 20, 12, 6],
  [46, 42, 38, 34, 20, 12, 6],
  [46, 42, 38, 34, 20, 12, 6],
  [50, 44, 40, 36, 20, 10, 0],
  [52, 46, 42, 36, 18, 8, 0],
  [56, 48, 44, 38, 16, 6, 0],
]
const SLOTS = [L1, L2, L3, L4, M1, M2, WILD]

function apportion(ratios: readonly number[], total: number): number[] {
  const sum = ratios.reduce((a, b) => a + b, 0)
  const exact = ratios.map((r) => (r / sum) * total)
  const out = exact.map(Math.floor)
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac)
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length]!.i]!++
  return out
}

function makeReel(reel: number, scatters: number, pairs: number): ReelSpec {
  const weights = new Array<number>(SYMBOL_COUNT).fill(0)
  const shares = apportion(RATIOS[reel]!, STRIP - scatters)
  SLOTS.forEach((symbol, i) => (weights[symbol] = shares[i]!))
  weights[SCATTER] = scatters
  return { weights, scatterPairs: pairs }
}

function feasible(scatters: number, pairs: number): boolean {
  if (pairs * 2 > scatters) return false
  const groups = scatters - pairs
  return STRIP - scatters >= groups * (ROWS - 1)
}

interface Params {
  a: [number, number]
  b: [number, number]
  c: [number, number]
}

function configFor(p: Params): GameConfig {
  return {
    ...EMBER_CONFIG,
    reels: [
      makeReel(0, p.a[0], p.a[1]),
      makeReel(1, p.a[0], p.a[1]),
      makeReel(2, p.a[0], p.a[1]),
      makeReel(3, p.b[0], p.b[1]),
      makeReel(4, p.b[0], p.b[1]),
      makeReel(5, p.c[0], p.c[1]),
    ],
  }
}

/** Frequencies of exactly 3, 4, 5 and 6-or-more scatters. */
function rates(config: GameConfig): { mini: number; minor: number; major: number; jackpot: number } {
  const dist = scatterCountDistribution(config)
  const at = (n: number): number => dist[n] ?? 0
  let six = 0
  for (let n = 6; n < dist.length; n++) six += dist[n]!
  // A tier counts the band it owns: 3 exactly, 4 exactly, 5 or more for Major.
  let fivePlus = 0
  for (let n = 5; n < dist.length; n++) fivePlus += dist[n]!
  return { mini: at(3), minor: at(4), major: fivePlus, jackpot: six }
}

const err = (got: number, wantOneIn: number): number => Math.abs(Math.log((got || 1e-12) * wantOneIn))

const results: { p: Params; score: number; r: ReturnType<typeof rates> }[] = []

for (let sa = 3; sa <= 16; sa++)
  for (let pa = 0; pa * 2 <= sa && pa <= 6; pa++) {
    if (!feasible(sa, pa)) continue
    for (let sb = 2; sb <= 14; sb++)
      for (let pb = 0; pb * 2 <= sb && pb <= 5; pb++) {
        if (!feasible(sb, pb)) continue
        if (sb > sa) continue
        for (let sc = 1; sc <= 12; sc++)
          for (let pc = 0; pc * 2 <= sc && pc <= 4; pc++) {
            if (!feasible(sc, pc)) continue
            if (sc > sb) continue
            const p: Params = { a: [sa, pa], b: [sb, pb], c: [sc, pc] }
            const r = rates(configFor(p))
            if (r.jackpot <= 0) continue
            const score =
              err(r.mini, TARGET.mini) * 1.2 + err(r.minor, TARGET.minor) + err(r.major, TARGET.major) + err(r.jackpot, TARGET.jackpot) * 1.2
            results.push({ p, score, r })
          }
      }
  }

results.sort((x, y) => x.score - y.score)
const oneIn = (v: number): string => (v > 0 ? `1 in ${(1 / v).toFixed(0)}` : 'never')

console.log('reels 1-3   reels 4-5   reel 6   |    mini      minor      major     jackpot')
for (const { p, r } of results.slice(0, 10)) {
  console.log(
    `  ${p.a[0]}/${p.a[1]}       ${p.b[0]}/${p.b[1]}        ${p.c[0]}/${p.c[1]}     |` +
      `${oneIn(r.mini).padStart(10)}${oneIn(r.minor).padStart(11)}${oneIn(r.major).padStart(11)}${oneIn(r.jackpot).padStart(12)}`,
  )
}

const best = results[0]
if (best) {
  console.log('\nbest weights:')
  configFor(best.p).reels.forEach((spec, i) => {
    console.log(`  reel ${i + 1}  ${spec.weights.map((v) => String(v).padStart(4)).join('')}   pairs ${spec.scatterPairs}`)
  })
}
