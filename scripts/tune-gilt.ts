/**
 * Tunes Gilt Vault.
 *
 * The climbing multiplier looks like it should make the free round non-linear
 * in the paytable, but it does not: the multiplier only ever asks whether a
 * spin paid *anything*, and every paying symbol has a non-zero entry, so which
 * spins ratchet is decided by the grids alone. The round's value is therefore
 * still linear in each paytable cell — it is just that a cell inside the round
 * is worth its multiplier at the time. One pass measures both, and the search
 * afterwards is arithmetic.
 */
import { GILT_CONFIG } from '../src/game/gilt.ts'
import { SlotMachine } from '../src/game/machine.ts'
import { L1, L2, L3, L4, M1, M2, SYMBOL_COUNT, WILD } from '../src/game/symbols.ts'

const TARGET_RTP = 0.94
const SPINS = Number(process.argv[2] ?? 2_000_000)

const REELS = GILT_CONFIG.reels.length
const ROWS = GILT_CONFIG.rows

/** Ways completed by `symbol` on one screen, or zero if it does not run all three reels. */
function waysOn(grid: Int8Array, symbol: number): number {
  let ways = 1
  for (let reel = 0; reel < REELS; reel++) {
    let here = 0
    for (let row = 0; row < ROWS; row++) {
      const cell = grid[reel * ROWS + row]!
      if (cell === symbol || cell === WILD) here++
    }
    if (here === 0) return 0
    ways *= here
  }
  return ways
}

const PAYING = [L1, L2, L3, L4, M1, M2]

function measure() {
  const machine = new SlotMachine(GILT_CONFIG, 20260825)
  const base = new Array<number>(SYMBOL_COUNT).fill(0)
  const free = new Array<number>(SYMBOL_COUNT).fill(0)
  let bonus = 0
  let hits = 0
  let rounds = 0
  let freeSpinsPlayed = 0
  let retriggers = 0
  let multiplierSum = 0
  const tiers = { mini: 0, minor: 0, major: 0 }

  for (let i = 0; i < SPINS; i++) {
    machine.next()
    bonus += machine.bonusPayout
    if (machine.tier) tiers[machine.tier.name]++

    let paid = machine.bonusPayout > 0
    for (const symbol of PAYING) {
      const ways = waysOn(machine.grid, symbol)
      if (ways > 0) {
        base[symbol]! += ways
        paid = true
      }
    }

    if (machine.free) {
      rounds++
      freeSpinsPlayed += machine.free.played
      retriggers += machine.free.retriggers
      multiplierSum += machine.free.finalMultiplier
      paid = true
      for (const spin of machine.free.spins) {
        for (const symbol of PAYING) {
          const ways = waysOn(spin.grid, symbol)
          if (ways > 0) free[symbol]! += ways * spin.multiplier
        }
      }
    }
    if (paid) hits++
  }

  return { base, free, bonus, hits, rounds, freeSpinsPlayed, retriggers, multiplierSum, tiers, totalBet: machine.totalBet }
}

console.log(`measuring ${SPINS.toLocaleString('en-GB')} spins...\n`)
const m = measure()
const wagered = SPINS * m.totalBet
const bonusRtp = m.bonus / wagered

console.log(`  bonus tiers        ${(bonusRtp * 100).toFixed(2)}% RTP`)
console.log(`    mini 1 in ${(SPINS / (m.tiers.mini || 1)).toFixed(0)}  minor 1 in ${(SPINS / (m.tiers.minor || 1)).toFixed(0)}  major 1 in ${(SPINS / (m.tiers.major || 1)).toFixed(0)}`)
console.log(`  free round         1 in ${(SPINS / (m.rounds || 1)).toFixed(0)} spins`)
console.log(`    spins per round  ${(m.freeSpinsPlayed / (m.rounds || 1)).toFixed(2)}  (${(m.retriggers / (m.rounds || 1)).toFixed(2)} from retriggers)`)
console.log(`    final multiplier ${(m.multiplierSum / (m.rounds || 1)).toFixed(2)} average`)
console.log(`  hit frequency      ${((m.hits / SPINS) * 100).toFixed(1)}%`)
console.log(`  reels must supply  ${((TARGET_RTP - bonusRtp) * 100).toFixed(2)}%\n`)

const groups: { name: string; ids: number[] }[] = [
  { name: 'L1/L2', ids: [L1, L2] },
  { name: 'L3/L4', ids: [L3, L4] },
  { name: 'M1', ids: [M1] },
  { name: 'M2', ids: [M2] },
]

/** Credits per spin added by one credit on a group's cell, base and free. */
const coeff = (ids: number[]): { base: number; free: number } => ({
  base: ids.reduce((s, id) => s + m.base[id]!, 0) / SPINS,
  free: ids.reduce((s, id) => s + m.free[id]!, 0) / SPINS,
})

console.log('  credits/spin per +1 on each cell:')
const co = new Map(groups.map((g) => [g.name, coeff(g.ids)]))
for (const g of groups) {
  const c = co.get(g.name)!
  console.log(`    ${g.name.padEnd(6)} base ${c.base.toFixed(4)}  free ${c.free.toFixed(4)}  total ${(c.base + c.free).toFixed(4)}`)
}

const CHOICES: Record<string, number[]> = {
  'L1/L2': [4, 5, 6, 8],
  'L3/L4': [10, 12, 15, 16, 20],
  M1: [25, 30, 40, 50, 60],
  M2: [60, 75, 80, 100, 120, 150],
}

const need = (TARGET_RTP - bonusRtp) * m.totalBet // credits per spin the reels owe
let best: { pays: Record<string, number>; rtp: number; err: number } | null = null

for (const a of CHOICES['L1/L2']!) {
  for (const b of CHOICES['L3/L4']!) {
    if (b <= a) continue
    for (const c of CHOICES.M1!) {
      if (c <= b) continue
      for (const d of CHOICES.M2!) {
        if (d <= c) continue
        const pays: Record<string, number> = { 'L1/L2': a, 'L3/L4': b, M1: c, M2: d }
        let credits = 0
        for (const g of groups) {
          const k = co.get(g.name)!
          credits += pays[g.name]! * (k.base + k.free)
        }
        const err = Math.abs(credits - need)
        if (!best || err < best.err) best = { pays, rtp: bonusRtp + credits / m.totalBet, err }
      }
    }
  }
}

console.log(`\n  best whole-number paytable:`)
for (const g of groups) console.log(`    ${g.name.padEnd(6)} ${best!.pays[g.name]}`)
console.log(`    predicted RTP ${(best!.rtp * 100).toFixed(2)}%`)
