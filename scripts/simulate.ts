/**
 * Monte Carlo verification of the payout engine.
 *
 * Imports the same modules the game imports, so what is measured here is what
 * ships. Run with:  node scripts/simulate.ts --spins 10000000
 */
import { CONFIG, tierPay, type GameConfig } from '../src/game/config.ts'
import { SlotMachine } from '../src/game/machine.ts'
import { SYMBOL_NAMES, SCATTER } from '../src/game/symbols.ts'
import {
  expectedBonusReturn,
  expectedLineReturn,
  rawTierProbabilities,
  reelScatterDistribution,
} from '../src/game/analysis.ts'

export interface SimResult {
  spins: number
  wagered: number
  won: number
  rtp: number
  lineWon: number
  hits: number
  lineHits: number
  hitFrequency: number
  tierCounts: Map<string, number>
  tierWon: Map<string, number>
  longestMiniDrought: number
  pityFired: number
  cooldownBlocked: number
  biggestWin: number
  scatterHistogram: number[]
}

export function runSimulation(config: GameConfig, spins: number, seed: number): SimResult {
  const machine = new SlotMachine(config, seed)

  const tierCounts = new Map<string, number>()
  const tierWon = new Map<string, number>()
  for (const tier of config.tiers) {
    tierCounts.set(tier.name, 0)
    tierWon.set(tier.name, 0)
  }

  let won = 0
  let lineWon = 0
  let hits = 0
  let lineHits = 0
  let biggestWin = 0
  let pityFired = 0
  let cooldownBlocked = 0
  let longestMiniDrought = 0
  let sinceMini = 0
  const scatterHistogram = new Array<number>(16).fill(0)

  for (let i = 0; i < spins; i++) {
    machine.next()

    won += machine.totalPayout
    lineWon += machine.linePayout
    if (machine.totalPayout > 0) hits++
    if (machine.linePayout > 0) lineHits++
    if (machine.totalPayout > biggestWin) biggestWin = machine.totalPayout
    if (machine.pityForced) pityFired++
    if (machine.cooldownBlocked) cooldownBlocked++

    const scatters = machine.scatterCount
    if (scatters < scatterHistogram.length) scatterHistogram[scatters]!++

    const tier = machine.tier
    if (tier) {
      tierCounts.set(tier.name, tierCounts.get(tier.name)! + 1)
      tierWon.set(tier.name, tierWon.get(tier.name)! + machine.bonusPayout)
    }

    if (tier?.name === 'mini') {
      if (sinceMini > longestMiniDrought) longestMiniDrought = sinceMini
      sinceMini = 0
    } else {
      sinceMini++
    }
  }
  if (sinceMini > longestMiniDrought) longestMiniDrought = sinceMini

  const wagered = spins * config.totalBet
  return {
    spins,
    wagered,
    won,
    rtp: won / wagered,
    lineWon,
    hits,
    lineHits,
    hitFrequency: hits / spins,
    tierCounts,
    tierWon,
    longestMiniDrought,
    pityFired,
    cooldownBlocked,
    biggestWin,
    scatterHistogram,
  }
}

export interface BustResult {
  sessions: number
  mean: number
  median: number
  p10: number
  p90: number
  survivedCap: number
}

/**
 * How long a 1000-credit balance lasts at 10 a spin. A fresh machine per
 * session, because the pity timer and cooldown reset when you sit down.
 */
export function runBustSimulation(
  config: GameConfig,
  sessions: number,
  startingCredits: number,
  seed: number,
  capSpins = 200_000,
): BustResult {
  const lengths: number[] = []
  let survivedCap = 0

  for (let s = 0; s < sessions; s++) {
    const machine = new SlotMachine(config, (seed + s * 2654435761) >>> 0)
    let balance = startingCredits
    let spins = 0
    while (balance >= config.totalBet && spins < capSpins) {
      balance -= config.totalBet
      machine.next()
      balance += machine.totalPayout
      spins++
    }
    if (spins >= capSpins) survivedCap++
    lengths.push(spins)
  }

  lengths.sort((a, b) => a - b)
  const at = (q: number): number => lengths[Math.min(lengths.length - 1, Math.floor(q * lengths.length))]!
  return {
    sessions,
    mean: lengths.reduce((a, b) => a + b, 0) / lengths.length,
    median: at(0.5),
    p10: at(0.1),
    p90: at(0.9),
    survivedCap,
  }
}

// ---------------------------------------------------------------- reporting

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`
const oneIn = (p: number): string => (p > 0 ? `1 in ${(1 / p).toFixed(1)}` : 'never')
const pad = (s: string | number, n: number): string => String(s).padStart(n)

export function printWeightTable(config: GameConfig): void {
  const header = ['reel', ...SYMBOL_NAMES.map((n) => pad(n, 8)), pad('pairs', 7), pad('total', 7)].join('')
  console.log(header)
  console.log('-'.repeat(header.length))
  config.reels.forEach((spec, i) => {
    const total = spec.weights.reduce((a, b) => a + b, 0)
    const cells = spec.weights.map((v) => pad(v, 8)).join('')
    console.log(`${pad(i + 1, 4)}${cells}${pad(spec.scatterPairs, 7)}${pad(total, 7)}`)
  })
}

function printReport(config: GameConfig, spins: number, seed: number, sessions: number): void {
  console.log('\n=== REEL STRIPS ===\n')
  printWeightTable(config)
  console.log('\nVisible scatters per reel (closed form):')
  config.reels.forEach((_, i) => {
    const [zero, one, two] = reelScatterDistribution(config, i)
    console.log(`  reel ${i + 1}:  none ${pct(zero)}   one ${pct(one)}   two ${pct(two)}`)
  })

  console.log('\n=== CLOSED FORM (before pity and cooldown) ===\n')
  const lineExp = expectedLineReturn(config)
  const bonusExp = expectedBonusReturn(config)
  console.log(`  line return    ${lineExp.toFixed(4)} credits/spin   ${pct(lineExp / config.totalBet)} RTP`)
  console.log(`  bonus return   ${bonusExp.toFixed(4)} credits/spin   ${pct(bonusExp / config.totalBet)} RTP`)
  console.log(`  total          ${(lineExp + bonusExp).toFixed(4)} credits/spin   ${pct((lineExp + bonusExp) / config.totalBet)} RTP`)
  const raw = rawTierProbabilities(config)
  for (const tier of config.tiers) {
    const p = raw.get(tier.name) ?? 0
    console.log(`  ${pad(tier.name, 6)}  ${tier.scatters} scatters   ${oneIn(p)} spins   pays ${tierPay(tier, config.totalBet)}`)
  }

  console.log(`\n=== MONTE CARLO (${spins.toLocaleString()} spins, seed ${seed}) ===\n`)
  const started = Date.now()
  const r = runSimulation(config, spins, seed)
  const elapsed = (Date.now() - started) / 1000

  console.log(`  wagered          ${r.wagered.toLocaleString()}`)
  console.log(`  won              ${Math.round(r.won).toLocaleString()}`)
  console.log(`  RTP              ${pct(r.rtp)}`)
  console.log(`  hit frequency    ${pct(r.hitFrequency)}  (${oneIn(r.hitFrequency)} spins)`)
  console.log(`  line hits only   ${pct(r.lineHits / r.spins)}`)
  console.log(`  biggest win      ${r.biggestWin.toLocaleString()} credits`)

  console.log('\n  RTP by source')
  const lineRtp = r.lineWon / r.wagered
  console.log(`    lines          ${pct(lineRtp)}   ${pct(lineRtp / r.rtp)} of return`)
  for (const tier of config.tiers) {
    const share = (r.tierWon.get(tier.name) ?? 0) / r.wagered
    console.log(`    ${pad(tier.name, 6)}         ${pct(share)}   ${pct(share / r.rtp)} of return`)
  }

  console.log('\n  Effective bonus frequency (after pity and cooldown)')
  for (const tier of config.tiers) {
    const count = r.tierCounts.get(tier.name) ?? 0
    console.log(`    ${pad(tier.name, 6)}         ${oneIn(count / r.spins)} spins   (${count.toLocaleString()} hits)`)
  }

  console.log(`\n  longest Mini drought   ${r.longestMiniDrought.toLocaleString()} spins`)
  console.log(`  pity timer fired       ${r.pityFired.toLocaleString()}  (${pct(r.pityFired / r.spins)} of spins)`)
  console.log(`  cooldown blocked       ${r.cooldownBlocked.toLocaleString()}  (${pct(r.cooldownBlocked / r.spins)} of spins)`)

  console.log('\n  Scatters on screen')
  r.scatterHistogram.forEach((count, n) => {
    if (count === 0) return
    console.log(`    ${pad(n, 2)}  ${pad(count.toLocaleString(), 12)}  ${oneIn(count / r.spins)}`)
  })

  console.log(`\n=== BALANCE LIFETIME (${sessions.toLocaleString()} sessions from 1000 credits) ===\n`)
  const bust = runBustSimulation(config, sessions, 1000, seed ^ 0x9e3779b9)
  console.log(`  mean     ${Math.round(bust.mean).toLocaleString()} spins`)
  console.log(`  median   ${bust.median.toLocaleString()} spins`)
  console.log(`  10th pct ${bust.p10.toLocaleString()} spins`)
  console.log(`  90th pct ${bust.p90.toLocaleString()} spins`)
  if (bust.survivedCap > 0) console.log(`  ${bust.survivedCap} session(s) never busted within the cap`)

  console.log(`\nsimulated in ${elapsed.toFixed(1)}s\n`)
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const value = Number(process.argv[i + 1])
  return Number.isFinite(value) ? value : fallback
}

if (process.argv[1]?.endsWith('simulate.ts')) {
  const scatterWeights = CONFIG.reels.map((r) => r.weights[SCATTER])
  console.log(`scatter weights per reel: ${scatterWeights.join(' ')}`)
  printReport(CONFIG, arg('spins', 10_000_000), arg('seed', 1), arg('sessions', 5000))
}
