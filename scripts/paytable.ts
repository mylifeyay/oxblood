/**
 * Picks the line paytable.
 *
 * The brief's paytable is far too thin to reach its own RTP target — measured,
 * it returns 7.7% where the plan needs it to return roughly 48%. Its *shape*
 * is fine, so the job is to find whole-number pays that keep that shape,
 * land total RTP on target, and still read like a paytable on a real cabinet
 * rather than a spreadsheet. Fractional pays are out: credits tick in whole
 * numbers on the meter.
 */
import { CONFIG } from '../src/game/config.ts'
import { L1, L2, L3, L4, M1, M2, WILD } from '../src/game/symbols.ts'
import { expectedLineReturn } from '../src/game/analysis.ts'
import { runSimulation } from './simulate.ts'

const TARGET_RTP = 0.94
const PROBE_SPINS = 4_000_000

console.log(`measuring effective bonus return over ${PROBE_SPINS.toLocaleString()} spins...`)
const probe = runSimulation(CONFIG, PROBE_SPINS, 7)
let bonusWon = 0
for (const tier of CONFIG.tiers) bonusWon += probe.tierWon.get(tier.name) ?? 0
const bonusPerSpin = bonusWon / probe.spins

const baseLine = expectedLineReturn(CONFIG) // at the brief's unscaled paytable
const needFromLines = TARGET_RTP * CONFIG.totalBet - bonusPerSpin
const idealScale = needFromLines / baseLine

console.log(`  bonus return    ${bonusPerSpin.toFixed(4)} credits/spin  (${((bonusPerSpin / CONFIG.totalBet) * 100).toFixed(2)}% RTP)`)
console.log(`  lines must give ${needFromLines.toFixed(4)} credits/spin  (${((needFromLines / CONFIG.totalBet) * 100).toFixed(2)}% RTP)`)
console.log(`  ideal scale     ${idealScale.toFixed(3)}x\n`)

// Candidate values, clustered around the ideal scale of the brief's shape.
const CHOICES = {
  l3: [3],
  l4: [12, 13],
  l5: [60, 62, 63, 65, 70],
  m3: [6, 7],
  m4: [30, 31, 32, 33, 35],
  m5: [150, 155, 158, 160, 165, 170],
  w3: [12, 13, 15],
  w4: [60, 63, 65, 70],
  w5: [1200, 1250, 1260, 1300],
}

/** Prefers pays a person would print on a glass. */
function roundness(v: number): number {
  if (v % 100 === 0) return 0
  if (v % 50 === 0) return 0.1
  if (v % 10 === 0) return 0.2
  if (v % 5 === 0) return 0.5
  return 1
}

interface Row {
  pays: number[]
  rtp: number
  lineRtp: number
  ugly: number
}

const results: Row[] = []

for (const l3 of CHOICES.l3)
  for (const l4 of CHOICES.l4)
    for (const l5 of CHOICES.l5)
      for (const m3 of CHOICES.m3)
        for (const m4 of CHOICES.m4)
          for (const m5 of CHOICES.m5)
            for (const w3 of CHOICES.w3)
              for (const w4 of CHOICES.w4)
                for (const w5 of CHOICES.w5) {
                  if (m3 < l3 || m4 < l4 || m5 < l5) continue // mediums must beat lows
                  if (w3 < m3 || w4 < m4 || w5 < m5) continue // wild must beat mediums
                  const paytable = CONFIG.paytable.map((r) => [...r])
                  for (const id of [L1, L2, L3, L4]) paytable[id] = [l3, l4, l5]
                  for (const id of [M1, M2]) paytable[id] = [m3, m4, m5]
                  paytable[WILD] = [w3, w4, w5]

                  const lineReturn = expectedLineReturn({ ...CONFIG, paytable })
                  const rtp = (lineReturn + bonusPerSpin) / CONFIG.totalBet
                  if (Math.abs(rtp - TARGET_RTP) > 0.002) continue

                  results.push({
                    pays: [l3, l4, l5, m3, m4, m5, w3, w4, w5],
                    rtp,
                    lineRtp: lineReturn / CONFIG.totalBet,
                    ugly: [l3, l4, l5, m3, m4, m5, w3, w4, w5].reduce((a, v) => a + roundness(v), 0),
                  })
                }

results.sort((a, b) => a.ugly - b.ugly || Math.abs(a.rtp - TARGET_RTP) - Math.abs(b.rtp - TARGET_RTP))

console.log(`${results.length} whole-number paytables land within 0.2 points of ${(TARGET_RTP * 100).toFixed(0)}% RTP. Roundest ten:\n`)
console.log('    L 3/4/5        M 3/4/5          WILD 3/4/5        line RTP   total RTP')
for (const r of results.slice(0, 10)) {
  const [l3, l4, l5, m3, m4, m5, w3, w4, w5] = r.pays as [number, number, number, number, number, number, number, number, number]
  console.log(
    `  ${`${l3}/${l4}/${l5}`.padEnd(14)} ${`${m3}/${m4}/${m5}`.padEnd(16)} ${`${w3}/${w4}/${w5}`.padEnd(17)} ` +
      `${(r.lineRtp * 100).toFixed(2)}%      ${(r.rtp * 100).toFixed(2)}%`,
  )
}
