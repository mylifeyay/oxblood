import { MAX_ENTRIES, type Book } from '../game/book.ts'
import { balanceOf, netOf, rtpOf, TIER_KINDS, type Totals } from '../game/ledger.ts'
import type { GameConfig } from '../game/config.ts'
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

/**
 * The one place the game explains itself.
 *
 * Every other screen was stripped of mechanics prose; this is where it lives,
 * because someone opening the statistics has asked how the thing works.
 */
function notes(book: Book, config: GameConfig): HTMLElement {
  const lifetime = book.lifetime
  const observed = rtpOf(lifetime)
  const wrap = document.createElement('div')
  wrap.className = 'stat-notes'

  const section = (title: string, text: string): void => {
    const h = document.createElement('h3')
    h.className = 'stat-notes__head'
    h.textContent = title
    const p = document.createElement('p')
    p.textContent = text
    wrap.append(h, p)
  }

  section(
    'Return',
    observed === null
      ? `Designed to pay back ${(DESIGNED_RTP * 100).toFixed(0)}% of everything wagered, verified over fifty million simulated spins. Spin to start measuring it.`
      : `Designed to pay back ${(DESIGNED_RTP * 100).toFixed(0)}%, verified over fifty million simulated spins. This machine has returned ${percent(observed)} across ${count(lifetime.spins)} spins. Expect it to wander for a few thousand spins before it settles — a Major is a hundred times the bet and lands about once in eight hundred.`,
  )

  section(
    'Where the money is',
    'Roughly half the return comes from ordinary wins and half from the three bonuses. The Mini is deliberately small: it lands about once in twenty-five spins, so anything generous would break the economy. The video is the prize at that tier and the credits are garnish. The Major is where money actually lands.',
  )

  section(
    'The two rules that bend the odds',
    `No bonus may follow another within ${config.cooldownSpins} spins — two clips back to back cheapens both. And if ${config.pitySpins} spins pass without a Mini, the next spin is forced to land one, so a drought can never run longer than ${config.pitySpins + config.cooldownSpins} spins. Both work by re-rolling the whole spin rather than nudging a reel, so every screen is a genuine draw.`,
  )

  section(
    'Honest reels',
    'The reels are decided before they start turning. The slowdown when a scatter is close only ever draws out what has already landed — near misses are never manufactured.',
  )

  section(
    'This machine',
    config.evaluation === 'ways'
      ? `Two hundred and forty-three ways: a symbol pays on adjacent reels from the first, multiplied by how many places it lands on each. Wins come often and most are small. Bet is ${config.totalBet} at the base level.`
      : `${config.lineCount} fixed lines, paying left to right from reel one. Bet is ${config.totalBet} at the base level, ${config.betPerLine} a line.`,
  )

  const kept = document.createElement('p')
  kept.textContent = `The ledger keeps its last ${count(MAX_ENTRIES)} entries in full and folds anything older into a rolling total. It is holding ${count(book.retained)}.`
  wrap.append(kept)

  if (book.ephemeral) {
    const warn = document.createElement('p')
    warn.className = 'stat-warn'
    warn.textContent = 'This device will not let the game store anything, so these numbers disappear when you close it.'
    wrap.append(warn)
  }

  return wrap
}

/** The sheet is modal, so nothing moves behind it — this renders once. */
export function openStats(book: Book, config: GameConfig, onReset: () => void): void {
  const sheet = openSheet('Stats', (body) => {
    let confirming = false

    const render = (): void => {
      body.replaceChildren()
      body.append(hero('Balance', String(balanceOf(book.lifetime))), table(rowsFor(book.session, book.lifetime)), notes(book, config))

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
