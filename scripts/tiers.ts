/** Tier frequency on every cabinet, for the numbers the interface quotes. */
import { CONFIG } from '../src/game/config.ts'
import { JADE_CONFIG } from '../src/game/jade.ts'
import { EMBER_CONFIG } from '../src/game/ember.ts'
import { GILT_CONFIG } from '../src/game/gilt.ts'
import { SlotMachine } from '../src/game/machine.ts'
import type { GameConfig } from '../src/game/config.ts'

const SPINS = Number(process.argv[2] ?? 2_000_000)
const SEEDS = [11, 2029, 30313]

for (const [name, config] of [
  ['Oxblood', CONFIG],
  ['Jade Parlour', JADE_CONFIG],
  ['Ember Room', EMBER_CONFIG],
  ['Gilt Vault', GILT_CONFIG],
] as [string, GameConfig][]) {
  const tiers = { mini: 0, minor: 0, major: 0 }
  let spins = 0
  let longest = 0
  for (const seed of SEEDS) {
    const machine = new SlotMachine(config, seed)
    let since = 0
    for (let i = 0; i < SPINS; i++) {
      machine.next()
      spins++
      if (machine.tier) {
        tiers[machine.tier.name]++
        since = 0
      } else if (++since > longest) longest = since
    }
  }
  const any = tiers.mini + tiers.minor + tiers.major
  console.log(
    `  ${name.padEnd(14)} any 1 in ${(spins / any).toFixed(1).padStart(5)}   ` +
      `mini 1 in ${(spins / tiers.mini).toFixed(0).padStart(4)}  minor 1 in ${(spins / tiers.minor).toFixed(0).padStart(4)}  ` +
      `major 1 in ${(spins / tiers.major).toFixed(0).padStart(5)}   longest gap ${longest}`,
  )
}
