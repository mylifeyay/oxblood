/**
 * How evenly the stills land across the wilds.
 *
 * A wild wears `stills[position % stills.length]`, so with a small library the
 * mapping could in principle collapse — every wild on a strip landing on the
 * same residue and the whole cabinet showing one clip. It does not, because the
 * wilds are shuffled into the strip at arbitrary positions, but a library of
 * two or three is exactly where that would show, so it is worth checking.
 */
import { CONFIG } from '../src/game/config.ts'
import { JADE_CONFIG } from '../src/game/jade.ts'
import { GILT_CONFIG } from '../src/game/gilt.ts'
import { buildStrips } from '../src/game/reels.ts'
import { WILD } from '../src/game/symbols.ts'
import type { GameConfig } from '../src/game/config.ts'

for (const [name, config] of [['Oxblood', CONFIG], ['Jade', JADE_CONFIG], ['Gilt', GILT_CONFIG]] as [string, GameConfig][]) {
  const strips = buildStrips(config)
  const positions: number[] = []
  strips.forEach((strip) => {
    strip.symbols.forEach((symbol, at) => {
      if (symbol === WILD) positions.push(at)
    })
  })

  const rows: string[] = []
  for (const clips of [1, 2, 3, 5, 12]) {
    // Dealt round the strip, exactly as setStills does it, per reel.
    const tally = new Array<number>(clips).fill(0)
    let dealt = 0
    strips.forEach((strip) => {
      strip.symbols.forEach((symbol) => {
        if (symbol !== WILD) return
        tally[dealt++ % clips]! += 1
      })
    })
    const share = tally.map((n) => ((n / positions.length) * 100).toFixed(0) + '%')
    rows.push(`    ${String(clips).padStart(2)} clips: ${share.join(' ')}`)
  }
  console.log(`\n${name} — ${positions.length} wilds on the strips`)
  for (const r of rows) console.log(r)
}
