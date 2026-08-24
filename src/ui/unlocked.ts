import { formatDuration, getVideoBlob, listUnlocked, toggleLiked, type VideoMeta } from '../game/videos.ts'
import { openSheet } from './sheet.ts'

const when = (at: number | undefined): string => {
  if (!at) return ''
  const days = Math.floor((Date.now() - at) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/**
 * Plays a clip back in full, on demand. Nothing random here — this is the
 * review screen, so it starts at the beginning and you decide when to stop.
 */
function play(meta: VideoMeta, blob: Blob): void {
  const url = URL.createObjectURL(blob)

  const root = document.createElement('div')
  root.className = 'viewer'

  const video = document.createElement('video')
  video.className = 'viewer__video'
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.controls = true
  video.src = url

  const bar = document.createElement('div')
  bar.className = 'viewer__bar'
  const title = document.createElement('span')
  title.className = 'viewer__title'
  title.textContent = meta.name
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'btn-line'
  close.textContent = 'Close'

  const dismiss = (): void => {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
    root.remove()
  }
  close.addEventListener('click', dismiss)
  root.addEventListener('click', (event) => {
    if (event.target === root) dismiss()
  })

  bar.append(title, close)
  root.append(video, bar)
  document.body.append(root)
  void video.play().catch(() => {
    // Controls are showing; the player can start it themselves.
  })
}

export function openUnlocked(): void {
  let clips: VideoMeta[] = []

  const sheet = openSheet('Unlocked clips', (body) => {
    body.append(Object.assign(document.createElement('p'), { className: 'lib-empty', textContent: 'Loading' }))
  })

  const render = (): void => {
    const body = sheet.body
    body.replaceChildren()

    if (clips.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'lib-empty'
      empty.textContent = 'Nothing unlocked yet. Win a bonus and the clip it played turns up here.'
      body.append(empty)
      return
    }

    const liked = clips.filter((c) => c.liked).length
    const lead = document.createElement('p')
    lead.className = 'lib-storage'
    lead.textContent =
      `${clips.length === 1 ? '1 clip' : `${clips.length} clips`} unlocked` +
      (liked > 0 ? ` · ${liked} hearted` : '') +
      '. Win the same one twice and it still appears once, with the count.'
    body.append(lead)

    const grid = document.createElement('div')
    grid.className = 'clips'

    for (const clip of clips) {
      const card = document.createElement('div')
      card.className = 'clip clip--unlocked'

      const thumb = document.createElement('button')
      thumb.type = 'button'
      thumb.className = 'clip__thumb clip__thumb--button'
      const img = document.createElement('img')
      const url = URL.createObjectURL(clip.poster)
      img.src = url
      img.alt = ''
      img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true })
      const time = document.createElement('span')
      time.className = 'clip__time'
      time.textContent = formatDuration(clip.duration)
      const cue = document.createElement('span')
      cue.className = 'clip__play'
      cue.textContent = '▶'
      thumb.append(img, time, cue)
      thumb.addEventListener('click', async () => {
        const blob = await getVideoBlob(clip.id)
        if (blob) play(clip, blob)
      })

      const name = document.createElement('div')
      name.className = 'clip__name'
      name.textContent = clip.name
      name.title = clip.name

      const meta = document.createElement('div')
      meta.className = 'clip__meta'
      const times = clip.timesPlayed === 1 ? 'won once' : `won ${clip.timesPlayed}×`
      const last = when(clip.lastWonAt)
      meta.textContent = last ? `${times} · ${last}` : times

      const heart = document.createElement('button')
      heart.type = 'button'
      heart.className = clip.liked ? 'heart is-on' : 'heart'
      heart.textContent = clip.liked ? '♥' : '♡'
      heart.setAttribute('aria-pressed', String(Boolean(clip.liked)))
      heart.setAttribute('aria-label', `Heart ${clip.name}`)
      heart.addEventListener('click', async () => {
        clip.liked = await toggleLiked(clip.id)
        heart.className = clip.liked ? 'heart is-on' : 'heart'
        heart.textContent = clip.liked ? '♥' : '♡'
        heart.setAttribute('aria-pressed', String(clip.liked))
      })

      card.append(thumb, name, meta, heart)
      grid.append(card)
    }

    body.append(grid)
  }

  void listUnlocked().then((found) => {
    clips = found
    render()
  })
}
