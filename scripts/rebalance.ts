/**
 * Puts every cabinet back on target after a change to the bonus cadence.
 *
 * Payout is linear in every paytable cell and the paytable never affects which
 * screens land, so running the same seeds with some cells doubled measures what
 * those cells are worth with almost no sampling error — both runs see identical
 * grids.
 *
 * The correction is a scale rather than a hand-picked cell, so each table keeps
 * the shape it was tuned to. Only cells of ten or more are scaled: a cell that
 * pays 1 cannot take a 2% rise without becoming a 100% one, and closing the
 * whole gap on a single rare cell would quadruple a top prize to move the
 * average half a per cent. Rounding leaves a residual, so it iterates.
 */
import { CONFIG } from '../src/game/config.ts'
import { JADE_CONFIG } from '../src/game/jade.ts'
import { EMBER_CONFIG } from '../src/game/ember.ts'
import { GILT_CONFIG } from '../src/game/gilt.ts'
import { SlotMachine } from '../src/game/machine.ts'
import type { GameConfig } from '../src/game/config.ts'

const TARGET = 0.94
const SPINS = Number(process.argv[2] ?? 2_000_000)
const SEEDS = [11, 2029, 30313, 404041, 5050505]
/** Below this a whole credit is too coarse a step to scale with. */
const ADJUSTABLE = 10
const PASSES = 4

const cabinets: [string, GameConfig][] = [
  ['Oxblood', CONFIG],
  ['Jade Parlour', JADE_CONFIG],
  ['Ember Room', EMBER_CONFIG],
  ['Gilt Vault', GILT_CONFIG],
]

const clone = (table: readonly (readonly number[])[]): number[][] => table.map((row) => [...row])

function measure(config: GameConfig, table: number[][]) {
  const per: number[] = []
  let wagered = 0
  let won = 0
  let clips = 0
  let spins = 0
  for (const seed of SEEDS) {
    const machine = new SlotMachine({ ...config, paytable: table }, seed)
    let w = 0
    let p = 0
    for (let i = 0; i < SPINS; i++) {
      machine.next()
      w += machine.totalBet
      p += machine.totalPayout
      if (machine.tier) clips++
      spins++
    }
    per.push(p / w)
    wagered += w
    won += p
  }
  const mean = won / wagered
  const variance = per.reduce((s, r) => s + (r - mean) ** 2, 0) / (per.length - 1)
  return { rtp: mean, se: Math.sqrt(variance / per.length), clip: spins / clips }
}

for (const [name, config] of cabinets) {
  const before = measure(config, clone(config.paytable))
  let table = clone(config.paytable)

  for (let pass = 0; pass < PASSES; pass++) {
    const now = measure(config, table)
    if (Math.abs(now.rtp - TARGET) < 0.0005) break

    // What the adjustable cells are worth together, on identical grids.
    const doubled = table.map((row) => row.map((v) => (v >= ADJUSTABLE ? v * 2 : v)))
    const worth = measure(config, doubled).rtp - now.rtp
    if (worth <= 0) break

    const k = 1 + (TARGET - now.rtp) / worth
    table = table.map((row) => row.map((v) => (v >= ADJUSTABLE ? Math.max(1, Math.round(v * k)) : v)))
  }

  const after = measure(config, table)
  console.log(`\n${name}`)
  console.log(`  before   ${(before.rtp * 100).toFixed(2)}%  ± ${(before.se * 196).toFixed(2)}   clip 1 in ${before.clip.toFixed(1)}`)
  console.log(`  after    ${(after.rtp * 100).toFixed(2)}%  ± ${(after.se * 196).toFixed(2)}   clip 1 in ${after.clip.toFixed(1)}`)
  console.log(`  paytable ${JSON.stringify(table.filter((r) => r.some((v) => v > 0)))}`)
}
