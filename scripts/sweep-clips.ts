/**
 * How often a clip plays, and what it costs to make that happen.
 *
 * A clip plays on every bonus tier, so "show videos more often" means raising
 * the tier rate. Two levers do it without touching the reels: the cooldown that
 * suppresses a bonus right after another, and the pity timer that forces one
 * after a drought. Both add return as well as frequency, so each row also shows
 * the mini pay that would give the extra back.
 */
import { CONFIG } from '../src/game/config.ts'
import { JADE_CONFIG } from '../src/game/jade.ts'
import { EMBER_CONFIG } from '../src/game/ember.ts'
import { GILT_CONFIG } from '../src/game/gilt.ts'
import { SlotMachine } from '../src/game/machine.ts'
import type { GameConfig } from '../src/game/config.ts'

const SPINS = Number(process.argv[2] ?? 400_000)

const cabinets: [string, GameConfig][] = [
  ['Oxblood', CONFIG],
  ['Jade', JADE_CONFIG],
  ['Ember', EMBER_CONFIG],
  ['Gilt', GILT_CONFIG],
]

function run(config: GameConfig, seed: number) {
  const machine = new SlotMachine(config, seed)
  let wagered = 0
  let won = 0
  let clips = 0
  let miniPay = 0
  let longest = 0
  let since = 0
  for (let i = 0; i < SPINS; i++) {
    machine.next()
    wagered += machine.totalBet
    won += machine.totalPayout
    if (machine.tier) {
      clips++
      since = 0
      if (machine.tier.name === 'mini') miniPay += machine.bonusPayout
    } else if (++since > longest) longest = since
  }
  return { rtp: won / wagered, clipRate: SPINS / clips, miniShare: miniPay / wagered, longest }
}

const tweak = (config: GameConfig, pity: number, cooldown: number, mini: number): GameConfig => ({
  ...config,
  pitySpins: pity,
  cooldownSpins: cooldown,
  tiers: config.tiers.map((t) => (t.name === 'mini' ? { ...t, payMultiple: mini } : t)),
})

for (const [name, config] of cabinets) {
  console.log(`\n${name}`)
  console.log('  pity  cool  mini   clip 1 in    RTP     longest drought')
  for (const [pity, cool] of [
    [config.pitySpins, config.cooldownSpins],
    [30, 3],
    [25, 2],
    [20, 2],
    [20, 1],
  ] as const) {
    for (const mini of [5, 4, 3]) {
      const r = run(tweak(config, pity, cool, mini), 4242)
      console.log(
        `  ${String(pity).padStart(4)}  ${String(cool).padStart(4)}  ${String(mini).padStart(4)}  ` +
          `${r.clipRate.toFixed(1).padStart(10)}  ${(r.rtp * 100).toFixed(2).padStart(6)}%  ${String(r.longest).padStart(10)}`,
      )
    }
  }
}
