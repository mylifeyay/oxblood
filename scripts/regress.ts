/** All four cabinets, same seeds, so a change to one is visible in the others. */
import { CONFIG } from '../src/game/config.ts'
import { JADE_CONFIG } from '../src/game/jade.ts'
import { EMBER_CONFIG } from '../src/game/ember.ts'
import { GILT_CONFIG } from '../src/game/gilt.ts'
import { SlotMachine } from '../src/game/machine.ts'
import type { GameConfig } from '../src/game/config.ts'

const SPINS = Number(process.argv[2] ?? 1_000_000)
const SEEDS = [11, 2029, 30313]

const cabinets: [string, GameConfig][] = [
  ['Oxblood', CONFIG],
  ['Jade Parlour', JADE_CONFIG],
  ['Ember Room', EMBER_CONFIG],
  ['Gilt Vault', GILT_CONFIG],
]

for (const [name, config] of cabinets) {
  let wagered = 0
  let won = 0
  let hits = 0
  let spins = 0
  for (const seed of SEEDS) {
    const machine = new SlotMachine(config, seed)
    for (let i = 0; i < SPINS; i++) {
      machine.next()
      wagered += machine.totalBet
      won += machine.totalPayout
      if (machine.totalPayout > 0) hits++
      spins++
    }
  }
  console.log(
    `  ${name.padEnd(14)} RTP ${((won / wagered) * 100).toFixed(2)}%   hit ${((hits / spins) * 100).toFixed(1)}%   ` +
      `${config.reels.length}x${config.rows} ${config.evaluation}`,
  )
}
