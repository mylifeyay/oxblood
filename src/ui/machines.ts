import type { Book } from '../game/book.ts'
import { isEarned, isPlayable, MACHINES, unlockProgress, type MachineDef } from '../game/machines.ts'
import { saveSetting } from '../game/settings.ts'
import { openSheet } from './sheet.ts'

/**
 * The cabinet list.
 *
 * The bar fills and nothing explains why. What earns a machine is deliberately
 * not stated: finding out is part of it.
 */
export function openMachines(book: Book, activeId: string): void {
  openSheet('Machines', (body) => {
    const lifetime = book.lifetime

    const list = document.createElement('div')
    list.className = 'machine-list'

    for (const machine of MACHINES) {
      const playable = isPlayable(machine, lifetime)
      const earned = isEarned(machine, lifetime)
      const active = machine.id === activeId
      const built = machine.config !== null

      const row = document.createElement(playable && !active ? 'button' : 'div')
      row.className = 'machine'
      if (active) row.classList.add('is-active')
      if (!playable) row.classList.add('is-locked')
      row.style.setProperty('--accent', machine.accent)
      if (row instanceof HTMLButtonElement) row.type = 'button'

      const name = document.createElement('div')
      name.className = 'machine__name'
      name.textContent = earned || active ? machine.name : '???'

      const tagline = document.createElement('div')
      tagline.className = 'machine__tagline'
      tagline.textContent = earned || active ? machine.tagline : 'Sealed'

      const status = document.createElement('div')
      status.className = 'machine__status'
      status.textContent = active ? 'Playing now' : playable ? 'Tap to play' : earned && !built ? 'Coming soon' : 'Locked'

      row.append(name, tagline, status)

      if (!active) {
        const bar = document.createElement('div')
        bar.className = 'machine__bar'
        const fill = document.createElement('div')
        fill.className = 'machine__fill'
        fill.style.width = `${Math.round(unlockProgress(machine, lifetime) * 100)}%`
        bar.append(fill)
        row.append(bar)
      }

      if (playable && !active) {
        row.addEventListener('click', async () => {
          status.textContent = 'Opening'
          await saveSetting('machine', machine.id)
          // A cabinet swap changes the reels, the skin and the sound. Coming up
          // fresh is cleaner than rebuilding every part of a live machine.
          window.location.reload()
        })
      }

      list.append(row)
    }

    body.append(list)
  })
}

/** Machines that have just become playable, for the unlock announcement. */
export function newlyPlayable(before: Book['lifetime'], after: Book['lifetime']): MachineDef[] {
  return MACHINES.filter((m) => m.config !== null && !isEarned(m, before) && isEarned(m, after))
}
