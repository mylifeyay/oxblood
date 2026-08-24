/** Pooled verification of Gilt Vault across several seeds. */
import { GILT_CONFIG } from '../src/game/gilt.ts'
import { SlotMachine } from '../src/game/machine.ts'

const SPINS = Number(process.argv[2] ?? 2_000_000)
const SEEDS = [11, 2029, 30313, 404041, 5050505]

let wagered = 0
let won = 0
let hits = 0
let spins = 0
let rounds = 0
let freeWin = 0
let roundSpins = 0
let capped = 0
let biggest = 0
let biggestRound = 0
const tiers = { mini: 0, minor: 0, major: 0 }
const rtps: number[] = []

for (const seed of SEEDS) {
  const machine = new SlotMachine(GILT_CONFIG, seed)
  let seedWagered = 0
  let seedWon = 0
  for (let i = 0; i < SPINS; i++) {
    machine.next()
    seedWagered += machine.totalBet
    seedWon += machine.totalPayout
    if (machine.totalPayout > 0) hits++
    if (machine.tier) tiers[machine.tier.name]++
    if (machine.totalPayout > biggest) biggest = machine.totalPayout
    if (machine.free) {
      rounds++
      freeWin += machine.free.total
      roundSpins += machine.free.played
      if (machine.free.finalMultiplier >= GILT_CONFIG.free!.multiplierCap) capped++
      if (machine.free.total > biggestRound) biggestRound = machine.free.total
    }
    spins++
  }
  rtps.push(seedWon / seedWagered)
  wagered += seedWagered
  won += seedWon
}

const mean = won / wagered
const variance = rtps.reduce((s, r) => s + (r - mean) ** 2, 0) / (rtps.length - 1)
const se = Math.sqrt(variance / rtps.length)

console.log(`\nGILT VAULT, pooled ${spins.toLocaleString('en-GB')} spins`)
console.log(`  RTP           ${(mean * 100).toFixed(2)}%  ± ${(se * 100 * 1.96).toFixed(2)} (95%)`)
console.log(`  hit           ${((hits / spins) * 100).toFixed(1)}%`)
console.log(`  mini 1 in ${(spins / tiers.mini).toFixed(0)}  minor 1 in ${(spins / tiers.minor).toFixed(0)}  major 1 in ${(spins / tiers.major).toFixed(0)}`)
console.log(`  free round    1 in ${(spins / rounds).toFixed(0)} spins, ${(roundSpins / rounds).toFixed(2)} spins each`)
console.log(`  free share    ${((freeWin / won) * 100).toFixed(1)}% of everything paid`)
console.log(`  multiplier capped in ${((capped / rounds) * 100).toFixed(1)}% of rounds`)
console.log(`  biggest spin  ${biggest.toLocaleString('en-GB')}  (${(biggest / GILT_CONFIG.totalBet).toFixed(0)}x bet)`)
console.log(`  biggest round ${biggestRound.toLocaleString('en-GB')}  (${(biggestRound / GILT_CONFIG.totalBet).toFixed(0)}x bet)\n`)
