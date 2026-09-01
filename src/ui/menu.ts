import type { Book } from '../game/book.ts'
import type { Sound } from '../audio/sound.ts'
import { saveSetting } from '../game/settings.ts'
import { formatBytes, libraryBytes, listVideos } from '../game/videos.ts'
import { openSheet } from './sheet.ts'
import { openLibrary } from './library.ts'
import { openUnlocked } from './unlocked.ts'
import { openMachines } from './machines.ts'
import { openIntro } from './intro.ts'
import { listUnlocked } from '../game/videos.ts'

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

/**
 * `onLibraryChanged` fires when the player has been somewhere that could change
 * which clips exist or which have been played — the reels wear those, so they
 * need to hear about it.
 */
export function openMenu(book: Book, sound: Sound, activeMachineId: string, onLibraryChanged?: () => void): void {
  openSheet('Menu', (body) => {
    const list = document.createElement('div')
    list.className = 'menu-list'

    const unlocked = row('Unlocked clips', 'Counting wins', () => openUnlocked(onLibraryChanged))
    list.append(unlocked)
    void listUnlocked().then((clips) => {
      const hint = unlocked.querySelector('.menu-row__hint')
      if (!hint) return
      const hearted = clips.filter((c) => c.liked).length
      hint.textContent =
        clips.length === 0
          ? 'Win a bonus to unlock one'
          : `${clips.length === 1 ? '1 clip' : `${clips.length} clips`}${hearted ? ` · ${hearted} hearted` : ''}`
    })

    const library = row('Video library', 'Counting clips', () => openLibrary(onLibraryChanged))
    list.append(library)

    list.append(
      row('Machines', `${book.lifetime.spins.toLocaleString('en-GB')} spins played`, () => openMachines(book, activeMachineId)),
    )

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

    list.append(row('About this game', 'What it is, and how to play', () => openIntro(sound, () => openLibrary(onLibraryChanged))))

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
