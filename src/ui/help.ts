import { CONFIG, tierPay } from '../game/config.ts'
import { L1, L2, L3, L4, M1, M2, WILD, SCATTER } from '../game/symbols.ts'
import { PAYLINE_ROWS, REELS, ROWS } from '../game/paylines.ts'
import { FACES, FACE_CLASS } from './symbols.ts'
import { openSheet } from './sheet.ts'

const LOWS = [L1, L2, L3, L4]
const MEDIUMS = [M1, M2]

function glyph(symbol: number): HTMLElement {
  const el = document.createElement('span')
  el.className = `pay-glyph tile--${FACE_CLASS[symbol]} tile--${FACES[symbol]!.kind}`
  el.textContent = FACES[symbol]!.glyph
  return el
}

function heading(text: string): HTMLElement {
  const el = document.createElement('h3')
  el.className = 'help-heading'
  el.textContent = text
  return el
}

function note(text: string): HTMLElement {
  const el = document.createElement('p')
  el.className = 'help-note'
  el.textContent = text
  return el
}

/** One row per symbol group, with what it pays for three, four and five. */
function paytable(betPerLine: number): HTMLElement {
  const table = document.createElement('table')
  table.className = 'paytable'

  const head = document.createElement('tr')
  for (const label of ['', '3', '4', '5']) {
    const th = document.createElement('th')
    th.textContent = label
    head.append(th)
  }
  table.append(head)

  const addRow = (symbols: number[], pays: readonly [number, number, number]): void => {
    const tr = document.createElement('tr')
    const cell = document.createElement('td')
    cell.className = 'paytable__symbols'
    for (const s of symbols) cell.append(glyph(s))
    tr.append(cell)
    for (const pay of pays) {
      const td = document.createElement('td')
      td.className = 'paytable__pay'
      td.textContent = String(pay * betPerLine)
      tr.append(td)
    }
    table.append(tr)
  }

  addRow(LOWS, CONFIG.paytable[L1]!)
  addRow(MEDIUMS, CONFIG.paytable[M1]!)
  addRow([WILD], CONFIG.paytable[WILD]!)
  return table
}

/** A miniature five-by-three grid with the line drawn through it. */
function lineDiagram(rows: readonly number[]): HTMLElement {
  const grid = document.createElement('div')
  grid.className = 'payline'
  for (let row = 0; row < ROWS; row++) {
    for (let reel = 0; reel < REELS; reel++) {
      const cell = document.createElement('span')
      cell.className = rows[reel] === row ? 'payline__cell is-on' : 'payline__cell'
      grid.append(cell)
    }
  }
  return grid
}

export function openHelp(betPerLine: number): void {
  openSheet('How it pays', (body) => {
    const totalBet = betPerLine * CONFIG.lineCount

    body.append(
      note(
        `Betting ${totalBet} a spin — ${betPerLine} on each of ${CONFIG.lineCount} lines. Tap the bet meter to change it; every payout below moves with it.`,
      ),
    )

    body.append(heading('Line wins'))
    body.append(paytable(betPerLine))
    body.append(
      note('Lines pay left to right, starting from reel 1. Only the best win on each line counts.'),
    )

    const wildRow = document.createElement('p')
    wildRow.className = 'help-inline'
    wildRow.append(glyph(WILD))
    wildRow.append(
      document.createTextNode(' stands in for every symbol except the scatter, and pays on its own as well.'),
    )
    body.append(wildRow)

    body.append(heading('Bonus'))
    const scatterRow = document.createElement('p')
    scatterRow.className = 'help-inline'
    scatterRow.append(glyph(SCATTER))
    scatterRow.append(
      document.createTextNode(' pays anywhere on screen, not on a line. Land three or more and a clip from your library plays.'),
    )
    body.append(scatterRow)

    const tiers = document.createElement('table')
    tiers.className = 'paytable paytable--tiers'
    for (const tier of CONFIG.tiers) {
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
    body.append(
      note('Mini plays a Common clip, Minor a Rare one, Major a Legendary one. If a tier has no clips, it falls back to Common.'),
    )

    body.append(heading(`The ${CONFIG.lineCount} lines`))
    const lines = document.createElement('div')
    lines.className = 'paylines'
    PAYLINE_ROWS.forEach((rows, i) => {
      const wrap = document.createElement('div')
      wrap.className = 'payline-item'
      const label = document.createElement('span')
      label.className = 'payline-item__n'
      label.textContent = String(i + 1)
      wrap.append(label, lineDiagram(rows))
      lines.append(wrap)
    })
    body.append(lines)

    body.append(note('Credits are play money. There is nothing to buy and nothing to win.'))
  })
}
