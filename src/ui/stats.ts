import { MAX_ENTRIES, type Book } from '../game/book.ts'
import { balanceOf, netOf, rtpOf, TIER_KINDS, type Totals } from '../game/ledger.ts'
import { CONFIG } from '../game/config.ts'
import { openSheet } from './sheet.ts'

export const DESIGNED_RTP = 0.94

const count = (n: number): string => n.toLocaleString('en-GB')
const credits = (n: number): string => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-GB')}`
export const percent = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(2)}%`)

interface Row {
  label: string
  session: string
  lifetime: string
  sessionTone?: 'jade' | 'ember'
  lifetimeTone?: 'jade' | 'ember'
}

function toneOfNet(t: Totals): 'jade' | 'ember' | undefined {
  const n = netOf(t)
  return n > 0 ? 'jade' : n < 0 ? 'ember' : undefined
}

function rowsFor(session: Totals, lifetime: Totals): Row[] {
  const sessionTone = toneOfNet(session)
  const lifetimeTone = toneOfNet(lifetime)
  return [
    { label: 'Spins', session: count(session.spins), lifetime: count(lifetime.spins) },
    { label: 'Wagered', session: credits(session.wagered), lifetime: credits(lifetime.wagered) },
    { label: 'Won', session: credits(session.won), lifetime: credits(lifetime.won) },
    { label: 'Added', session: credits(session.added), lifetime: credits(lifetime.added) },
    {
      label: 'Net',
      session: credits(netOf(session)),
      lifetime: credits(netOf(lifetime)),
      ...(sessionTone ? { sessionTone } : {}),
      ...(lifetimeTone ? { lifetimeTone } : {}),
    },
    { label: 'Observed RTP', session: percent(rtpOf(session)), lifetime: percent(rtpOf(lifetime)) },
    { label: 'Biggest win', session: credits(session.biggestWin), lifetime: credits(lifetime.biggestWin) },
    { label: 'Won on lines', session: credits(session.wonByKind.line), lifetime: credits(lifetime.wonByKind.line) },
    ...TIER_KINDS.map((tier) => ({
      label: `${tier.charAt(0).toUpperCase()}${tier.slice(1)} bonuses`,
      session: count(session.tierCounts[tier]),
      lifetime: count(lifetime.tierCounts[tier]),
    })),
    {
      label: 'Longest Mini drought',
      session: `${count(session.longestMiniDrought)} spins`,
      lifetime: `${count(lifetime.longestMiniDrought)} spins`,
    },
    // A single running counter, not a per-session one — it is what drives the
    // pity timer, so splitting it across the columns would only mislead.
    { label: 'Spins since a Mini', session: '—', lifetime: count(lifetime.sinceMini) },
  ]
}

function hero(label: string, value: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'stat-hero'
  const l = document.createElement('span')
  l.className = 'stat-hero__label'
  l.textContent = label
  const v = document.createElement('span')
  v.className = 'stat-hero__value'
  v.textContent = value
  wrap.append(l, v)
  return wrap
}

function table(rows: Row[]): HTMLElement {
  const el = document.createElement('table')
  el.className = 'stats'

  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  for (const heading of ['', 'This session', 'Lifetime']) {
    const th = document.createElement('th')
    th.textContent = heading
    headRow.append(th)
  }
  thead.append(headRow)

  const tbody = document.createElement('tbody')
  for (const row of rows) {
    const tr = document.createElement('tr')
    const label = document.createElement('th')
    label.scope = 'row'
    label.textContent = row.label
    const session = document.createElement('td')
    session.textContent = row.session
    if (row.sessionTone) session.classList.add(`is-${row.sessionTone}`)
    const lifetime = document.createElement('td')
    lifetime.textContent = row.lifetime
    if (row.lifetimeTone) lifetime.classList.add(`is-${row.lifetimeTone}`)
    tr.append(label, session, lifetime)
    tbody.append(tr)
  }

  el.append(thead, tbody)
  return el
}

function notes(book: Book): HTMLElement {
  const lifetime = book.lifetime
  const observed = rtpOf(lifetime)
  const wrap = document.createElement('div')
  wrap.className = 'stat-notes'

  const designed = document.createElement('p')
  designed.textContent =
    observed === null
      ? `Designed RTP is ${(DESIGNED_RTP * 100).toFixed(0)}%. Spin to start measuring it.`
      : `Designed RTP is ${(DESIGNED_RTP * 100).toFixed(0)}%, and this has observed ${percent(observed)} over ${count(lifetime.spins)} spins. It takes a few thousand to settle, because a Major pays 1000 and lands about once in 800.`
  wrap.append(designed)

  const kept = document.createElement('p')
  kept.textContent = `The ledger keeps its last ${count(MAX_ENTRIES)} entries in full and folds anything older into a rolling total, so it never grows without bound. It is holding ${count(book.retained)}.`
  wrap.append(kept)

  const bet = document.createElement('p')
  bet.textContent = `Bet runs from ${CONFIG.betLevels[0]! * CONFIG.lineCount} to ${
    CONFIG.betLevels[CONFIG.betLevels.length - 1]! * CONFIG.lineCount
  } a spin, across ${CONFIG.lineCount} lines. Every payout scales with it, so these figures mix bets without distorting the return.`
  wrap.append(bet)

  if (book.ephemeral) {
    const warn = document.createElement('p')
    warn.className = 'stat-warn'
    warn.textContent = 'This device will not let the game store anything, so these numbers disappear when you close it.'
    wrap.append(warn)
  }

  return wrap
}

/** The sheet is modal, so nothing moves behind it — this renders once. */
export function openStats(book: Book, onReset: () => void): void {
  const sheet = openSheet('Stats', (body) => {
    let confirming = false

    const render = (): void => {
      body.replaceChildren()
      body.append(hero('Balance', String(balanceOf(book.lifetime))), table(rowsFor(book.session, book.lifetime)), notes(book))

      const box = document.createElement('div')
      box.className = 'reset-box'

      if (!confirming) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'btn-line btn-line--danger'
        button.textContent = 'Reset statistics'
        button.addEventListener('click', () => {
          confirming = true
          render()
        })
        box.append(button)
      } else {
        const ask = document.createElement('p')
        ask.className = 'lib-actions__ask'
        ask.textContent =
          'Clear every spin, win and bonus from the record? Your balance and your clips are kept. This cannot be undone.'
        const row = document.createElement('div')
        row.className = 'lib-actions__row'

        const keep = document.createElement('button')
        keep.type = 'button'
        keep.className = 'btn-line'
        keep.textContent = 'Keep them'
        keep.addEventListener('click', () => {
          confirming = false
          render()
        })

        const wipe = document.createElement('button')
        wipe.type = 'button'
        wipe.className = 'btn-line btn-line--danger'
        wipe.textContent = 'Reset'
        wipe.addEventListener('click', async () => {
          wipe.disabled = true
          await book.reset()
          onReset()
          sheet.close()
        })

        row.append(keep, wipe)
        box.append(ask, row)
      }

      body.append(box)
    }

    render()
  })
}
