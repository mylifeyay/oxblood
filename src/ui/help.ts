import { tierPay, type GameConfig } from '../game/config.ts'
import { L1, L2, L3, L4, M1, M2, WILD, SCATTER } from '../game/symbols.ts'
import { PAYLINE_ROWS, REELS, ROWS } from '../game/paylines.ts'
import { FACE_CLASS, type SymbolFace } from './symbols.ts'
import { openSheet } from './sheet.ts'

const LOWS = [L1, L2, L3, L4]
const MEDIUMS = [M1, M2]

function heading(text: string): HTMLElement {
  const el = document.createElement('h3')
  el.className = 'help-heading'
  el.textContent = text
  return el
}

export function openHelp(config: GameConfig, faces: readonly SymbolFace[]): void {
  const glyph = (symbol: number): HTMLElement => {
    const el = document.createElement('span')
    el.className = `pay-glyph tile--${FACE_CLASS[symbol]} tile--${faces[symbol]!.kind}`
    el.textContent = faces[symbol]!.glyph
    return el
  }

  const bet = config.betPerLine
  const totalBet = bet * config.lineCount
  const ways = config.evaluation === 'ways'

  openSheet('How it pays', (body) => {
    const stake = document.createElement('p')
    stake.className = 'help-stake'
    stake.textContent = ways ? `${totalBet} a spin · 243 ways` : `${totalBet} a spin · ${config.lineCount} lines`
    body.append(stake)

    body.append(heading(ways ? 'Ways' : 'Lines'))

    const table = document.createElement('table')
    table.className = 'paytable'
    const head = document.createElement('tr')
    for (const label of ['', '3', '4', '5']) {
      const th = document.createElement('th')
      th.textContent = label
      head.append(th)
    }
    table.append(head)

    const addRow = (symbols: number[]): void => {
      const pays = config.paytable[symbols[0]!]!
      if (pays.every((p) => p === 0)) return
      const tr = document.createElement('tr')
      const cell = document.createElement('td')
      cell.className = 'paytable__symbols'
      for (const s of symbols) cell.append(glyph(s))
      tr.append(cell)
      for (const pay of pays) {
        const td = document.createElement('td')
        td.className = 'paytable__pay'
        td.textContent = String(pay * bet)
        tr.append(td)
      }
      table.append(tr)
    }

    addRow(LOWS)
    addRow(MEDIUMS)
    addRow([WILD])
    body.append(table)

    const wildRow = document.createElement('p')
    wildRow.className = 'help-inline'
    wildRow.append(glyph(WILD))
    wildRow.append(document.createTextNode(ways ? ' substitutes for all but the scatter.' : ' substitutes for all but the scatter.'))
    body.append(wildRow)

    if (ways) {
      const note = document.createElement('p')
      note.className = 'help-inline'
      note.textContent = 'Wins pay left to right on adjacent reels, multiplied by how many places the symbol lands.'
      body.append(note)
    }

    body.append(heading('Bonus'))
    const scatterRow = document.createElement('p')
    scatterRow.className = 'help-inline'
    scatterRow.append(glyph(SCATTER))
    scatterRow.append(document.createTextNode(' pays anywhere, and plays a clip.'))
    body.append(scatterRow)

    const tiers = document.createElement('table')
    tiers.className = 'paytable paytable--tiers'
    for (const tier of config.tiers) {
      const tr = document.createElement('tr')
      const name = document.createElement('td')
      name.className = `paytable__tier is-${tier.name}`
      name.textContent = `${tier.name.charAt(0).toUpperCase()}${tier.name.slice(1)}`
      const count = document.createElement('td')
      count.textContent = `${tier.scatters} scatters`
      const pay = document.createElement('td')
      pay.className = 'paytable__pay'
      pay.textContent = String(tierPay(tier, totalBet))
      tr.append(name, count, pay)
      tiers.append(tr)
    }
    body.append(tiers)

    if (!ways) {
      body.append(heading(`The ${config.lineCount} lines`))
      const lines = document.createElement('div')
      lines.className = 'paylines'
      PAYLINE_ROWS.forEach((rows, i) => {
        const wrap = document.createElement('div')
        wrap.className = 'payline-item'
        const label = document.createElement('span')
        label.className = 'payline-item__n'
        label.textContent = String(i + 1)
        const grid = document.createElement('div')
        grid.className = 'payline'
        for (let row = 0; row < ROWS; row++) {
          for (let reel = 0; reel < REELS; reel++) {
            const cell = document.createElement('span')
            cell.className = rows[reel] === row ? 'payline__cell is-on' : 'payline__cell'
            grid.append(cell)
          }
        }
        wrap.append(label, grid)
        lines.append(wrap)
      })
      body.append(lines)
    }
  })
}
