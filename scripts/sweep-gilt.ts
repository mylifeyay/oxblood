/** Sweeps the vault weight to find how often the free round should land. */
import { GILT_CONFIG } from '../src/game/gilt.ts'
import { SlotMachine } from '../src/game/machine.ts'
import { FREE, L1 } from '../src/game/symbols.ts'
import type { GameConfig } from '../src/game/config.ts'

const SPINS = 300_000

/** Same cabinet with a different vault weight, taken out of the low symbol. */
function withFree(free: number): GameConfig {
  const reels = GILT_CONFIG.reels.map((spec) => {
    const weights = [...spec.weights]
    const delta = free - (weights[FREE] ?? 0)
    weights[FREE] = free
    weights[L1] = (weights[L1] ?? 0) - delta
    return { ...spec, weights }
  })
  return { ...GILT_CONFIG, reels }
}

console.log('  free  1 in     spins/round  avg mult  free share of reel win')
for (const free of [6, 7, 8, 9, 10, 11, 12, 14]) {
  const config = withFree(free)
  const machine = new SlotMachine(config, 777)
  let rounds = 0
  let played = 0
  let mult = 0
  let baseWin = 0
  let freeWin = 0
  for (let i = 0; i < SPINS; i++) {
    machine.next()
    baseWin += machine.linePayout
    if (machine.free) {
      rounds++
      played += machine.free.played
      mult += machine.free.finalMultiplier
      freeWin += machine.free.total
    }
  }
  const share = freeWin / (baseWin + freeWin || 1)
  console.log(
    `  ${String(free).padStart(4)}  ${(SPINS / (rounds || 1)).toFixed(0).padStart(6)}  ` +
      `${(played / (rounds || 1)).toFixed(2).padStart(11)}  ${(mult / (rounds || 1)).toFixed(2).padStart(8)}  ${(share * 100).toFixed(1).padStart(6)}%`,
  )
}
