/**
 * Searches for reel strips and a paytable scale that hit the design targets.
 *
 * Three things are being solved at once:
 *
 *   shape  — how often 4 and 5 scatters land relative to 3. Set by how many
 *            scatters sit as adjacent pairs rather than alone.
 *   level  — how often 3 scatters land at all. Set by the total scatter count.
 *   scale  — the paytable multiplier that brings total RTP to target.
 *
 * Closed form does the searching; Monte Carlo confirms it, because only a
 * simulation can measure what the pity timer and the cooldown do to the rates.
 * The aim is corrected from what the simulation reports and the search re-run,
 * which converges in two or three passes.
 */
import { CONFIG, type GameConfig, type ReelSpec } from '../src/game/config.ts'
import { L1, L2, L3, L4, M1, M2, WILD, SCATTER, SYMBOL_COUNT } from '../src/game/symbols.ts'
import { expectedLineReturn } from '../src/game/analysis.ts'
import { runSimulation } from './simulate.ts'

const STRIP = 200 // positions per reel; 0.5% weight granularity
const ROWS = 3

const TARGET = { mini: 25, minor: 150, major: 800 } // one in N spins
const TARGET_RTP = 0.94

/** The brief's non-scatter proportions, preserved exactly as ratios. */
const RATIOS: readonly number[][] = [
  [18, 18, 16, 16, 12, 10, 6],
  [18, 18, 16, 16, 12, 10, 6],
  [18, 18, 16, 16, 12, 10, 6],
  [20, 18, 18, 16, 12, 10, 4],
  [20, 20, 18, 16, 12, 8, 4],
]
const SLOTS = [L1, L2, L3, L4, M1, M2, WILD]

/**
 * Feel constraints, which are not negotiable and so bound the search.
 *
 * The anticipation only fires when reels 1 and 2 have both landed a scatter,
 * so those reels need a real scatter presence or the best moment in the game
 * never happens. And the brief front-loads scatters, which is what makes a
 * tease fail often enough to be worth having.
 */
const MIN_REEL_SCATTER_CHANCE = 0.11
const MAX_REEL_SCATTER_CHANCE = 0.3

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

interface Params {
  scattersA: number
  pairsA: number
  scattersB: number
  pairsB: number
}

function makeConfig(p: Params, paytableScale: number): GameConfig {
  return {
    ...CONFIG,
    reels: [
      makeReel(0, p.scattersA, p.pairsA),
      makeReel(1, p.scattersA, p.pairsA),
      makeReel(2, p.scattersA, p.pairsA),
      makeReel(3, p.scattersB, p.pairsB),
      makeReel(4, p.scattersB, p.pairsB),
    ],
    paytable: CONFIG.paytable.map((r) => r.map((v) => v * paytableScale)),
  }
}

// -------------------------------------------------------------- fast search

/** [none, one, two] for a reel with this many scatters, this many as pairs. */
function reelDist(scatters: number, pairs: number): [number, number, number] {
  const singles = scatters - pairs * 2
  const two = (2 * pairs) / STRIP
  const one = (ROWS * singles + 2 * pairs) / STRIP
  return [1 - one - two, one, two]
}

function feasible(scatters: number, pairs: number): boolean {
  if (pairs * 2 > scatters) return false
  const groups = scatters - pairs
  return STRIP - scatters >= groups * 2
}

function convolve(a: number[], b: readonly number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue
    for (let j = 0; j < b.length; j++) out[i + j]! += a[i]! * b[j]!
  }
  return out
}

interface Option {
  scatters: number
  pairs: number
  dist: [number, number, number]
  chance: number
  power: number[]
}

function options(power: number): Option[] {
  const out: Option[] = []
  for (let scatters = 3; scatters <= 90; scatters++) {
    for (let pairs = 0; pairs * 2 <= scatters && pairs <= 24; pairs++) {
      if (!feasible(scatters, pairs)) continue
      const dist = reelDist(scatters, pairs)
      const chance = dist[1] + dist[2]
      if (chance < MIN_REEL_SCATTER_CHANCE || chance > MAX_REEL_SCATTER_CHANCE) continue
      let acc: number[] = [1]
      for (let i = 0; i < power; i++) acc = convolve(acc, dist)
      out.push({ scatters, pairs, dist, chance, power: acc })
    }
  }
  return out
}

interface Aim {
  rawMini: number
  minorRatio: number
  majorRatio: number
}

interface Candidate {
  p: Params
  rawMini: number
  rawMinor: number
  rawMajor: number
  teaseRate: number
  score: number
}

function search(aim: Aim, frontA: Option[], backB: Option[]): Candidate[] {
  const results: Candidate[] = []

  for (const a of frontA) {
    for (const b of backB) {
      // The brief front-loads scatters; a tease that usually pays is not a tease.
      if (b.chance > a.chance) continue

      const dist = convolve(a.power, b.power)
      const rawMini = dist[3] ?? 0
      const rawMinor = dist[4] ?? 0
      let rawMajor = 0
      for (let n = 5; n < dist.length; n++) rawMajor += dist[n]!
      if (rawMini <= 0 || rawMinor <= 0 || rawMajor <= 0) continue
      if (rawMini < 0.02 || rawMini > 0.06) continue

      const score =
        Math.abs(Math.log(rawMinor / rawMini / aim.minorRatio)) * 1.5 +
        Math.abs(Math.log(rawMajor / rawMini / aim.majorRatio)) * 1.5 +
        Math.abs(Math.log(rawMini / aim.rawMini))

      results.push({
        p: { scattersA: a.scatters, pairsA: a.pairs, scattersB: b.scatters, pairsB: b.pairs },
        rawMini,
        rawMinor,
        rawMajor,
        teaseRate: a.chance * a.chance,
        score,
      })
    }
  }

  results.sort((x, y) => x.score - y.score)
  const picked: Candidate[] = []
  for (const c of results) {
    if (picked.length >= 8) break
    const near = picked.some(
      (q) =>
        Math.abs(q.p.scattersA - c.p.scattersA) <= 2 &&
        q.p.pairsA === c.p.pairsA &&
        Math.abs(q.p.scattersB - c.p.scattersB) <= 2 &&
        q.p.pairsB === c.p.pairsB,
    )
    if (!near) picked.push(c)
  }
  return picked
}

// -------------------------------------------------------- measure and refine

interface Measured {
  p: Params
  teaseRate: number
  miniEvery: number
  minorEvery: number
  majorEvery: number
  bonusPerSpin: number
  lineAtScaleOne: number
}

function measure(c: Candidate, spins: number): Measured {
  const config = makeConfig(c.p, 1)
  const r = runSimulation(config, spins, 12345)
  const every = (name: string): number => {
    const n = r.tierCounts.get(name) ?? 0
    return n > 0 ? r.spins / n : Infinity
  }
  let bonusWon = 0
  for (const tier of config.tiers) bonusWon += r.tierWon.get(tier.name) ?? 0
  return {
    p: c.p,
    teaseRate: c.teaseRate,
    miniEvery: every('mini'),
    minorEvery: every('minor'),
    majorEvery: every('major'),
    bonusPerSpin: bonusWon / r.spins,
    lineAtScaleOne: expectedLineReturn(config),
  }
}

function finalScore(m: Measured): number {
  const outOfBand = m.miniEvery < 22 || m.miniEvery > 28 ? 10 : 0
  return (
    outOfBand +
    Math.abs(Math.log(m.miniEvery / TARGET.mini)) +
    Math.abs(Math.log(m.minorEvery / TARGET.minor)) * 1.5 +
    Math.abs(Math.log(m.majorEvery / TARGET.major)) * 1.5
  )
}

const fmt = (x: number): string => (Number.isFinite(x) ? `1 in ${x.toFixed(0)}` : 'never')

console.log(`building candidate reels (${STRIP}-position strips)...`)
const frontA = options(3)
const backB = options(2)
console.log(`${frontA.length} front-reel options, ${backB.length} back-reel options\n`)

let aim: Aim = { rawMini: 1 / 30, minorRatio: TARGET.mini / TARGET.minor, majorRatio: TARGET.mini / TARGET.major }
let best: Measured | null = null

for (let pass = 1; pass <= 3; pass++) {
  const spins = pass === 3 ? 3_000_000 : 1_000_000
  const shortlist = search(aim, frontA, backB)
  if (shortlist.length === 0) {
    console.log('no candidate satisfied the feel constraints')
    break
  }

  console.log(`--- pass ${pass}  (aim: raw mini ${fmt(1 / aim.rawMini)}, minor ratio ${aim.minorRatio.toFixed(4)}, major ratio ${aim.majorRatio.toFixed(5)}) ---`)
  console.log('   sc(1-3) pr  sc(4-5) pr |  raw mini  raw minor  raw major |  eff mini  eff minor  eff major |  tease  bonus/spin')

  const measured = shortlist.map((c) => {
    const m = measure(c, spins)
    console.log(
      `  ${String(c.p.scattersA).padStart(6)} ${String(c.p.pairsA).padStart(3)} ${String(c.p.scattersB).padStart(7)} ${String(c.p.pairsB).padStart(2)} |` +
        `${fmt(1 / c.rawMini).padStart(10)}${fmt(1 / c.rawMinor).padStart(11)}${fmt(1 / c.rawMajor).padStart(11)} |` +
        `${fmt(m.miniEvery).padStart(10)}${fmt(m.minorEvery).padStart(11)}${fmt(m.majorEvery).padStart(11)} |` +
        `${fmt(1 / c.teaseRate).padStart(8)}  ${m.bonusPerSpin.toFixed(3)}`,
    )
    return m
  })

  measured.sort((x, y) => finalScore(x) - finalScore(y))
  best = measured[0]!
  console.log('')

  // Correct the aim by however far the simulation landed from target.
  aim = {
    rawMini: aim.rawMini * (best.miniEvery / TARGET.mini),
    minorRatio: aim.minorRatio * (best.minorEvery / TARGET.minor),
    majorRatio: aim.majorRatio * (best.majorEvery / TARGET.major),
  }
}

if (!best) process.exit(1)

console.log('=== CHOSEN ===\n')
console.log(`  reels 1-3: ${best.p.scattersA} scatters, ${best.p.pairsA} as adjacent pairs`)
console.log(`  reels 4-5: ${best.p.scattersB} scatters, ${best.p.pairsB} as adjacent pairs`)
console.log(`  mini  ${fmt(best.miniEvery)}   minor ${fmt(best.minorEvery)}   major ${fmt(best.majorEvery)}`)
console.log(`  anticipation fires ${fmt(1 / best.teaseRate)} spins`)
console.log(`  bonus return ${best.bonusPerSpin.toFixed(4)} credits/spin  (${((best.bonusPerSpin / CONFIG.totalBet) * 100).toFixed(2)}% RTP)`)

const needFromLines = TARGET_RTP * CONFIG.totalBet - best.bonusPerSpin
const scale = needFromLines / best.lineAtScaleOne
console.log(`\n  line return at scale 1: ${best.lineAtScaleOne.toFixed(4)} credits/spin`)
console.log(`  lines must supply ${needFromLines.toFixed(4)} credits/spin for ${(TARGET_RTP * 100).toFixed(0)}% RTP`)
console.log(`  => paytable scale ${scale.toFixed(3)}x\n`)

console.log('  scaled paytable (exact, before rounding):')
;[['L1', L1], ['L2', L2], ['L3', L3], ['L4', L4], ['M1', M1], ['M2', M2], ['WILD', WILD]].forEach(([name, id]) => {
  const row = CONFIG.paytable[id as number]!
  console.log(`    ${String(name).padEnd(6)}${row.map((v) => (v * scale).toFixed(2).padStart(10)).join('')}`)
})

console.log('\n  final reel weights (counts out of 200, and as a percentage):')
makeConfig(best.p, 1).reels.forEach((spec, i) => {
  const counts = spec.weights.map((v) => String(v).padStart(5)).join('')
  const pcts = spec.weights.map((v) => ((v / STRIP) * 100).toFixed(1).padStart(6)).join('')
  console.log(`    reel ${i + 1} ${counts}   |${pcts}`)
})
console.log(`    pairs: reels 1-3 ${best.p.pairsA}, reels 4-5 ${best.p.pairsB}`)
