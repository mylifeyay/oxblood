import {
  formatDuration,
  getVideoBlob,
  isFullyUnlocked,
  listUnlocked,
  segmentCount,
  toggleLiked,
  unlockedOf,
  unlockedRuns,
  type VideoMeta,
} from '../game/videos.ts'
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
 * Plays back only what has been won.
 *
 * Deliberately not the native controls: those come with a scrubber, and a
 * scrubber would let you drag straight into a part of the video you have not
 * unlocked. This steps through the unlocked runs and skips the rest.
 */
function play(meta: VideoMeta, blob: Blob): void {
  const runs = unlockedRuns(meta)
  if (runs.length === 0) return

  const url = URL.createObjectURL(blob)
  let index = 0
  let closed = false

  const root = document.createElement('div')
  root.className = 'viewer'

  const stage = document.createElement('div')
  stage.className = 'viewer__stage'

  const video = document.createElement('video')
  video.className = 'viewer__video'
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.preload = 'auto'
  video.src = url

  // Always on top of the picture, never below it, so there is always a way out.
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'viewer__close'
  close.textContent = 'Close'
  close.setAttribute('aria-label', 'Close the player')

  const title = document.createElement('div')
  title.className = 'viewer__title'
  title.textContent = meta.name

  const part = document.createElement('div')
  part.className = 'viewer__part'

  const hint = document.createElement('div')
  hint.className = 'viewer__hint'
  hint.textContent = 'Tap the picture to pause'

  stage.append(video, close, title, part, hint)
  root.append(stage)

  const dismiss = (): void => {
    if (closed) return
    closed = true
    video.pause()
    video.removeEventListener('timeupdate', onTime)
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
    document.removeEventListener('keydown', onKey)
    root.remove()
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') dismiss()
  }

  const showPart = (): void => {
    part.textContent = runs.length > 1 ? `Part ${index + 1} of ${runs.length}` : ''
  }

  const startRun = async (): Promise<void> => {
    const run = runs[index]
    if (!run) return dismiss()
    showPart()
    video.currentTime = run.start
    try {
      await video.play()
    } catch {
      // Autoplay refused; the picture can be tapped to start it.
    }
  }

  function onTime(): void {
    const run = runs[index]
    if (!run) return
    if (video.currentTime < run.end - 0.05) return
    index++
    if (index >= runs.length) {
      video.pause()
      part.textContent = 'End'
      return
    }
    void startRun()
  }

  video.addEventListener('timeupdate', onTime)
  video.addEventListener('loadedmetadata', () => void startRun(), { once: true })

  close.addEventListener('click', (event) => {
    event.stopPropagation()
    dismiss()
  })
  root.addEventListener('click', (event) => {
    if (event.target === root) dismiss()
  })
  video.addEventListener('click', () => {
    if (video.paused) void video.play().catch(() => {})
    else video.pause()
  })
  document.addEventListener('keydown', onKey)

  video.load()
  document.body.append(root)
}

/** A row of blocks: lit for the parts won, dark for the parts still hidden. */
function segmentBar(meta: VideoMeta): HTMLElement {
  const total = segmentCount(meta.duration)
  const unlocked = new Set(unlockedOf(meta))
  const bar = document.createElement('div')
  bar.className = 'segments'
  // Past a couple of dozen blocks they stop being readable, so collapse to a
  // proportion bar instead.
  if (total > 24) {
    bar.classList.add('segments--dense')
    const fill = document.createElement('span')
    fill.className = 'segments__fill'
    fill.style.width = `${Math.round((unlocked.size / total) * 100)}%`
    bar.append(fill)
    return bar
  }
  for (let i = 0; i < total; i++) {
    const cell = document.createElement('span')
    cell.className = unlocked.has(i) ? 'segments__cell is-on' : 'segments__cell'
    bar.append(cell)
  }
  return bar
}

export function openUnlocked(onClosed?: () => void): void {
  let clips: VideoMeta[] = []

  const sheet = openSheet(
    'Unlocked clips',
    (body) => {
      body.append(Object.assign(document.createElement('p'), { className: 'lib-empty', textContent: 'Loading' }))
    },
    onClosed,
  )

  const render = (): void => {
    const body = sheet.body
    body.replaceChildren()

    if (clips.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'lib-empty'
      empty.textContent = 'Nothing unlocked yet.'
      body.append(empty)
      return
    }

    const complete = clips.filter(isFullyUnlocked).length
    const lead = document.createElement('p')
    lead.className = 'lib-storage'
    lead.textContent =
      `${clips.length === 1 ? '1 video' : `${clips.length} videos`}` + (complete > 0 ? ` · ${complete} complete` : '')
    body.append(lead)

    const grid = document.createElement('div')
    grid.className = 'clips'

    for (const clip of clips) {
      const total = segmentCount(clip.duration)
      const got = unlockedOf(clip).length
      const done = isFullyUnlocked(clip)

      const card = document.createElement('div')
      card.className = done ? 'clip clip--unlocked is-complete' : 'clip clip--unlocked'

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

      const progress = document.createElement('div')
      progress.className = 'clip__meta'
      const times = clip.timesPlayed === 1 ? 'won once' : `won ${clip.timesPlayed}×`
      progress.textContent = done ? `${times} · complete` : `${times} · ${got} of ${total} parts`

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

      const foot = document.createElement('div')
      foot.className = 'clip__foot'
      foot.append(heart)
      if (clip.lastWonAt) {
        const last = document.createElement('span')
        last.className = 'clip__when'
        last.textContent = when(clip.lastWonAt)
        foot.append(last)
      }

      card.append(thumb, name, progress, segmentBar(clip), foot)
      grid.append(card)
    }

    body.append(grid)
  }

  void listUnlocked().then((found) => {
    clips = found
    render()
  })
}
