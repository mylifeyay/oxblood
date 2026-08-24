import type { Book } from '../game/book.ts'
import type { Sound } from '../audio/sound.ts'
import { saveSetting } from '../game/settings.ts'
import { formatBytes, libraryBytes, listVideos } from '../game/videos.ts'
import { openSheet } from './sheet.ts'
import { openStats } from './stats.ts'
import { openLibrary } from './library.ts'

function row(label: string, hint: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'menu-row'
  const name = document.createElement('span')
  name.className = 'menu-row__label'
  name.textContent = label
  const detail = document.createElement('span')
  detail.className = 'menu-row__hint'
  detail.textContent = hint
  button.append(name, detail)
  button.addEventListener('click', onClick)
  return button
}

export function openMenu(book: Book, sound: Sound): void {
  openSheet('Menu', (body) => {
    const list = document.createElement('div')
    list.className = 'menu-list'

    const spins = book.lifetime.spins
    list.append(row('Stats', spins === 1 ? '1 spin so far' : `${spins.toLocaleString('en-GB')} spins so far`, () => openStats(book)))

    const library = row('Video library', 'Counting clips', () => openLibrary())
    list.append(library)

    const soundRow = row('Sound', '', () => {
      sound.unlock()
      const next = !sound.isMuted
      sound.setMuted(next)
      void saveSetting('muted', next)
      paintSound()
      if (!next) sound.reelStop(0)
    })
    const paintSound = (): void => {
      const hint = soundRow.querySelector('.menu-row__hint')
      if (hint) hint.textContent = sound.isMuted ? 'Off — tap to turn on' : 'On — tap to mute'
      soundRow.classList.toggle('is-off', sound.isMuted)
    }
    paintSound()
    list.append(soundRow)

    void listVideos().then((videos) => {
      const hint = library.querySelector('.menu-row__hint')
      if (!hint) return
      hint.textContent =
        videos.length === 0
          ? 'No clips yet — import some'
          : `${videos.length === 1 ? '1 clip' : `${videos.length} clips`} · ${formatBytes(libraryBytes(videos))}`
    })

    body.append(list)

    const stamp = document.createElement('p')
    stamp.className = 'menu-stamp'
    stamp.textContent = `Build ${__BUILD_STAMP__}`
    body.append(stamp)
  })
}
