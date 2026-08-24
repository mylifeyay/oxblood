/**
 * Tunes Jade Parlour's ways paytable.
 *
 * Ways payout is linear in every paytable cell, so one Monte Carlo pass can
 * measure how much each cell is worth — the total number of ways won at each
 * symbol and reel count. After that the search is arithmetic rather than
 * simulation, and only the winner needs confirming.
 */
import { JADE_CONFIG } from '../src/game/jade.ts'
import { SlotMachine } from '../src/game/machine.ts'
import { L1, L2, L3, L4, M1, M2, SCATTER, SYMBOL_COUNT, WILD } from '../src/game/symbols.ts'
import { REELS, ROWS } from '../src/game/paylines.ts'

const TARGET_RTP = 0.94
const SPINS = 4_000_000

/** Ways won per symbol per reel-count, and the bonus return, in one pass. */
function measure(): { ways: number[][]; bonusPerSpin: number; wagered: number; hits: number } {
  const machine = new SlotMachine(JADE_CONFIG, 4242)
  const ways: number[][] = Array.from({ length: SYMBOL_COUNT }, () => [0, 0, 0])
  let bonus = 0
  let hits = 0

  for (let i = 0; i < SPINS; i++) {
    machine.next()
    bonus += machine.bonusPayout
    let paidSomething = machine.bonusPayout > 0

    for (let symbol = 0; symbol < SYMBOL_COUNT; symbol++) {
      if (symbol === WILD || symbol === SCATTER) continue
      let count = 1
      let reels = 0
      for (let reel = 0; reel < REELS; reel++) {
        let here = 0
        for (let row = 0; row < ROWS; row++) {
          const cell = machine.grid[reel * ROWS + row]!
          if (cell === symbol || cell === WILD) here++
        }
        if (here === 0) break
        count *= here
        reels++
      }
      if (reels >= 3) {
        ways[symbol]![reels - 3]! += count
        paidSomething = true
      }
    }
    if (paidSomething) hits++
  }

  return { ways, bonusPerSpin: bonus / SPINS, wagered: SPINS * machine.totalBet, hits }
}

console.log(`measuring ${SPINS.toLocaleString('en-GB')} spins...`)
const { ways, bonusPerSpin, wagered, hits } = measure()
const bonusRtp = (bonusPerSpin * SPINS) / wagered
console.log(`  bonus return ${(bonusRtp * 100).toFixed(2)}% RTP`)
console.log(`  ways must supply ${((TARGET_RTP - bonusRtp) * 100).toFixed(2)}%`)
console.log(`  hit frequency ${((hits / SPINS) * 100).toFixed(1)}%\n`)

const groups: { name: string; ids: number[] }[] = [
  { name: 'L1/L2', ids: [L1, L2] },
  { name: 'L3/L4', ids: [L3, L4] },
  { name: 'M1', ids: [M1] },
  { name: 'M2', ids: [M2] },
]

/** Credits per spin added by one credit on a cell. */
const coeff = (ids: number[], k: number): number => ids.reduce((sum, id) => sum + ways[id]![k]!, 0) / SPINS

console.log('  credits/spin per +1 on each cell:')
for (const g of groups) console.log(`    ${g.name.padEnd(6)} 3:${coeff(g.ids, 0).toFixed(4)}  4:${coeff(g.ids, 1).toFixed(4)}  5:${coeff(g.ids, 2).toFixed(4)}`)

const CHOICES: Record<string, number[][]> = {
  'L1/L2': [[1], [3, 4, 5], [12, 15, 18, 20]],
  'L3/L4': [[2, 3], [6, 8, 10], [20, 25, 30]],
  M1: [[5, 6], [15, 18, 20], [60, 70, 75, 80]],
  M2: [[8, 10], [25, 30, 35], [100, 120, 125, 150]],
}

const roundness = (v: number): number => (v % 50 === 0 ? 0 : v % 25 === 0 ? 0.1 : v % 10 === 0 ? 0.2 : v % 5 === 0 ? 0.4 : 1)

interface Row {
  pays: number[]
  rtp: number
  waysRtp: number
  ugly: number
}
const results: Row[] = []
const totalBet = JADE_CONFIG.totalBet

for (const a3 of CHOICES['L1/L2']![0]!)
  for (const a4 of CHOICES['L1/L2']![1]!)
    for (const a5 of CHOICES['L1/L2']![2]!)
      for (const b3 of CHOICES['L3/L4']![0]!)
        for (const b4 of CHOICES['L3/L4']![1]!)
          for (const b5 of CHOICES['L3/L4']![2]!)
            for (const c3 of CHOICES['M1']![0]!)
              for (const c4 of CHOICES['M1']![1]!)
                for (const c5 of CHOICES['M1']![2]!)
                  for (const d3 of CHOICES['M2']![0]!)
                    for (const d4 of CHOICES['M2']![1]!)
                      for (const d5 of CHOICES['M2']![2]!) {
                        if (b3 < a3 || b4 < a4 || b5 < a5) continue
                        if (c3 < b3 || c4 < b4 || c5 < b5) continue
                        if (d3 < c3 || d4 < c4 || d5 < c5) continue

                        const perSpin =
                          coeff([L1, L2], 0) * a3 + coeff([L1, L2], 1) * a4 + coeff([L1, L2], 2) * a5 +
                          coeff([L3, L4], 0) * b3 + coeff([L3, L4], 1) * b4 + coeff([L3, L4], 2) * b5 +
                          coeff([M1], 0) * c3 + coeff([M1], 1) * c4 + coeff([M1], 2) * c5 +
                          coeff([M2], 0) * d3 + coeff([M2], 1) * d4 + coeff([M2], 2) * d5

                        const waysRtp = perSpin / totalBet
                        const rtp = waysRtp + bonusRtp
                        if (Math.abs(rtp - TARGET_RTP) > 0.0025) continue

                        const pays = [a3, a4, a5, b3, b4, b5, c3, c4, c5, d3, d4, d5]
                        results.push({ pays, rtp, waysRtp, ugly: pays.reduce((s, v) => s + roundness(v), 0) })
                      }

results.sort((x, y) => x.ugly - y.ugly || Math.abs(x.rtp - TARGET_RTP) - Math.abs(y.rtp - TARGET_RTP))
console.log(`\n${results.length} whole-number tables land within a quarter point of ${(TARGET_RTP * 100).toFixed(0)}%. Roundest eight:\n`)
console.log('   L1/L2        L3/L4        M1            M2             ways    total')
for (const r of results.slice(0, 8)) {
  const [a3, a4, a5, b3, b4, b5, c3, c4, c5, d3, d4, d5] = r.pays as number[]
  console.log(
    `  ${`${a3}/${a4}/${a5}`.padEnd(12)} ${`${b3}/${b4}/${b5}`.padEnd(12)} ${`${c3}/${c4}/${c5}`.padEnd(13)} ${`${d3}/${d4}/${d5}`.padEnd(14)} ` +
      `${(r.waysRtp * 100).toFixed(2)}%  ${(r.rtp * 100).toFixed(2)}%`,
  )
}
