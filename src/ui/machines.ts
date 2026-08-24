import type { Book } from '../game/book.ts'
import { isLocked, isPlayable, MACHINES, type MachineDef } from '../game/machines.ts'
import { openSheet } from './sheet.ts'

const count = (n: number): string => n.toLocaleString('en-GB')

function statusOf(machine: MachineDef, spins: number, activeId: string): string {
  if (machine.id === activeId) return 'Playing now'
  if (isPlayable(machine, spins)) return 'Ready'
  if (isLocked(machine, spins)) return `${count(spins)} of ${count(machine.unlockAtSpins)} spins`
  return `Not built yet · unlocks at ${count(machine.unlockAtSpins)} spins`
}

/**
 * The cabinet list. One machine is built; the others are here so the shape of
 * the thing is visible and so adding one later is data, not a redesign.
 */
export function openMachines(book: Book, activeId: string): void {
  openSheet('Machines', (body) => {
    const spins = book.lifetime.spins

    const lead = document.createElement('p')
    lead.className = 'lib-storage'
    lead.textContent = 'More cabinets open up the more you play. Your clips and your balance follow you between them.'
    body.append(lead)

    const list = document.createElement('div')
    list.className = 'machine-list'

    for (const machine of MACHINES) {
      const playable = isPlayable(machine, spins)
      const row = document.createElement('div')
      row.className = 'machine'
      if (machine.id === activeId) row.classList.add('is-active')
      if (!playable) row.classList.add('is-locked')
      row.style.setProperty('--accent', machine.accent)

      const name = document.createElement('div')
      name.className = 'machine__name'
      name.textContent = machine.name

      const tagline = document.createElement('div')
      tagline.className = 'machine__tagline'
      tagline.textContent = machine.tagline

      const status = document.createElement('div')
      status.className = 'machine__status'
      status.textContent = statusOf(machine, spins, activeId)

      row.append(name, tagline, status)

      if (machine.config === null && machine.unlockAtSpins > 0) {
        const bar = document.createElement('div')
        bar.className = 'machine__bar'
        const fill = document.createElement('div')
        fill.className = 'machine__fill'
        fill.style.width = `${Math.min(100, Math.round((spins / machine.unlockAtSpins) * 100))}%`
        bar.append(fill)
        row.append(bar)
      }

      list.append(row)
    }

    body.append(list)

    const note = document.createElement('p')
    note.className = 'help-note'
    note.textContent = 'Only Oxblood is built so far. The others show what the shelf will look like.'
    body.append(note)
  })
}
