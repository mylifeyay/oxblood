import { ACCEPT, importVideos, type ImportOutcome } from '../game/import.ts'
import {
  cycleTier,
  deleteVideos,
  formatBytes,
  formatDuration,
  libraryBytes,
  listVideos,
  setTier,
  TIERS,
  type Tier,
  type VideoMeta,
} from '../game/videos.ts'
import { openSheet, type Sheet } from './sheet.ts'

/** Past this, warn — iOS gets less willing to hold on to the library. */
const WARN_BYTES = 1024 * 1024 * 1024

const TIER_LABEL: Record<Tier, string> = { common: 'Common', rare: 'Rare', legendary: 'Legendary' }
const TIER_PLAYS: Record<Tier, string> = { common: 'Mini', rare: 'Minor', legendary: 'Major' }

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = className
  el.textContent = label
  el.addEventListener('click', onClick)
  return el
}

function para(text: string, className?: string): HTMLParagraphElement {
  const el = document.createElement('p')
  if (className) el.className = className
  el.textContent = text
  return el
}

export function openLibrary(onClosed?: () => void): void {
  let videos: VideoMeta[] = []
  let selection = new Set<string>()
  let selecting = false
  let confirmingDelete = false
  let busy = false
  let lastOutcomes: ImportOutcome[] | null = null

  // Poster object URLs are revoked on every redraw and on close. Leaking these
  // across hundreds of renders would eat memory for no reason.
  let posterUrls: string[] = []
  const releasePosters = (): void => {
    for (const url of posterUrls) URL.revokeObjectURL(url)
    posterUrls = []
  }

  // Lives on document.body, not in the sheet: every redraw replaces the sheet's
  // children, and a detached input does not reliably open the iOS picker.
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = ACCEPT
  input.multiple = true
  input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0'
  document.body.append(input)

  let sheet: Sheet | null = null

  const refresh = async (): Promise<void> => {
    videos = await listVideos()
    selection = new Set([...selection].filter((id) => videos.some((v) => v.id === id)))
    render()
  }

  async function storageLine(): Promise<string> {
    try {
      const estimate = await navigator.storage?.estimate?.()
      if (!estimate?.quota) return ''
      const persisted = (await navigator.storage?.persisted?.()) ?? false
      return `${formatBytes(estimate.usage ?? 0)} of ${formatBytes(estimate.quota)} used on this device · ${
        persisted ? 'storage is persistent' : 'iOS may clear this if space runs short'
      }`
    } catch {
      return ''
    }
  }

  function header(body: HTMLElement): void {
    const total = libraryBytes(videos)
    const summary = document.createElement('div')
    summary.className = 'lib-summary'
    const count = document.createElement('span')
    count.className = 'lib-summary__count'
    count.textContent = videos.length === 1 ? '1 clip' : `${videos.length} clips`
    const size = document.createElement('span')
    size.className = 'lib-summary__size'
    size.textContent = formatBytes(total)
    summary.append(count, size)
    body.append(summary)

    const line = para('', 'lib-storage')
    body.append(line)
    void storageLine().then((text) => {
      line.textContent = text
    })

    if (total > WARN_BYTES) {
      body.append(para(`Past ${formatBytes(WARN_BYTES)}. Consider deleting clips you have stopped enjoying.`, 'lib-warn'))
    }
  }

  function toolbar(body: HTMLElement): void {
    const bar = document.createElement('div')
    bar.className = 'lib-toolbar'

    bar.append(button('Import videos', 'btn-line btn-line--primary', () => input.click()))

    if (videos.length > 0) {
      bar.append(
        button(selecting ? 'Cancel' : 'Select', 'btn-line', () => {
          selecting = !selecting
          confirmingDelete = false
          if (!selecting) selection.clear()
          render()
        }),
      )
    }

    if (selecting) {
      const allSelected = selection.size === videos.length
      bar.append(
        button(allSelected ? 'Select none' : 'Select all', 'btn-line', () => {
          if (allSelected) selection.clear()
          else for (const v of videos) selection.add(v.id)
          render()
        }),
      )
    }

    body.append(bar)
  }

  function grid(body: HTMLElement): void {
    if (videos.length === 0) {
      body.append(
        para('No clips yet.', 'lib-empty'),
      )
      return
    }

    const wrap = document.createElement('div')
    wrap.className = 'clips'

    for (const video of videos) {
      const card = document.createElement('div')
      card.className = 'clip'
      if (selecting) card.classList.add('clip--selectable')
      if (selection.has(video.id)) card.classList.add('is-selected')

      const thumb = document.createElement('div')
      thumb.className = 'clip__thumb'
      const img = document.createElement('img')
      const url = URL.createObjectURL(video.poster)
      posterUrls.push(url)
      img.src = url
      img.alt = ''
      img.loading = 'lazy'
      const time = document.createElement('span')
      time.className = 'clip__time'
      time.textContent = formatDuration(video.duration)
      thumb.append(img, time)

      if (selecting) {
        const tick = document.createElement('span')
        tick.className = 'clip__tick'
        tick.textContent = selection.has(video.id) ? '✓' : ''
        thumb.append(tick)
      }

      const name = document.createElement('div')
      name.className = 'clip__name'
      name.textContent = video.name
      name.title = video.name

      const meta = document.createElement('div')
      meta.className = 'clip__meta'
      meta.textContent = `${formatBytes(video.bytes)} · played ${video.timesPlayed}×`

      const tierChip = button(TIER_LABEL[video.tier], `tier-chip tier-chip--${video.tier}`, async () => {
        if (selecting) return
        await cycleTier(video.id)
        await refresh()
      })
      tierChip.title = `${TIER_LABEL[video.tier]} · ${TIER_PLAYS[video.tier]}`

      card.append(thumb, name, meta, tierChip)

      if (selecting) {
        card.addEventListener('click', (event) => {
          if (event.target instanceof HTMLElement && event.target.closest('.tier-chip')) return
          if (selection.has(video.id)) selection.delete(video.id)
          else selection.add(video.id)
          confirmingDelete = false
          render()
        })
      }

      wrap.append(card)
    }

    body.append(wrap)
  }

  function actions(body: HTMLElement): void {
    if (!selecting || selection.size === 0) return
    const ids = [...selection]

    const bar = document.createElement('div')
    bar.className = 'lib-actions'

    if (confirmingDelete) {
      bar.append(
        para(
          ids.length === 1 ? 'Delete this clip? This cannot be undone.' : `Delete ${ids.length} clips? This cannot be undone.`,
          'lib-actions__ask',
        ),
      )
      const row = document.createElement('div')
      row.className = 'lib-actions__row'
      row.append(
        button('Keep them', 'btn-line', () => {
          confirmingDelete = false
          render()
        }),
        button('Delete', 'btn-line btn-line--danger', async () => {
          if (busy) return
          busy = true
          try {
            await deleteVideos(ids)
            selection.clear()
            confirmingDelete = false
            selecting = false
            await refresh()
          } finally {
            busy = false
          }
        }),
      )
      bar.append(row)
      body.append(bar)
      return
    }

    bar.append(para(`${ids.length} selected — set the tier, or remove them`, 'lib-actions__ask'))

    const row = document.createElement('div')
    row.className = 'lib-actions__row'
    for (const tier of TIERS) {
      row.append(
        button(TIER_LABEL[tier], `btn-line tier-chip--${tier}`, async () => {
          if (busy) return
          busy = true
          try {
            await setTier(ids, tier)
            await refresh()
          } finally {
            busy = false
          }
        }),
      )
    }
    bar.append(row)

    const removeRow = document.createElement('div')
    removeRow.className = 'lib-actions__row'
    removeRow.append(
      button(`Delete ${ids.length}`, 'btn-line btn-line--danger', () => {
        confirmingDelete = true
        render()
      }),
    )
    bar.append(removeRow)

    body.append(bar)
  }

  function outcomes(body: HTMLElement): void {
    if (!lastOutcomes) return
    const imported = lastOutcomes.filter((o) => o.status === 'imported').length
    const duplicates = lastOutcomes.filter((o) => o.status === 'duplicate')
    const failures = lastOutcomes.filter((o) => o.status === 'failed')

    const box = document.createElement('div')
    box.className = 'lib-report'

    const parts: string[] = []
    if (imported > 0) parts.push(imported === 1 ? '1 clip imported' : `${imported} clips imported`)
    if (duplicates.length > 0) parts.push(`${duplicates.length} already in the library`)
    if (failures.length > 0) parts.push(failures.length === 1 ? '1 could not be read' : `${failures.length} could not be read`)
    box.append(para(parts.length > 0 ? parts.join(', ') : 'Nothing to import', 'lib-report__head'))

    for (const outcome of [...duplicates, ...failures]) {
      box.append(para(`${outcome.name} — ${outcome.detail}`, 'lib-report__line'))
    }

    box.append(
      button('Dismiss', 'btn-line', () => {
        lastOutcomes = null
        render()
      }),
    )
    body.append(box)
  }

  function render(): void {
    if (!sheet) return
    releasePosters()
    const body = sheet.body
    body.replaceChildren()
    header(body)
    outcomes(body)
    toolbar(body)
    actions(body)
    grid(body)
  }

  function renderProgress(current: { index: number; total: number; name: string; phase: string }, done: ImportOutcome[]): void {
    if (!sheet) return
    releasePosters()
    const body = sheet.body
    body.replaceChildren()
    body.append(para(`Importing ${Math.min(current.index + 1, current.total)} of ${current.total}`, 'lib-report__head'))
    body.append(para(`${current.name} — ${current.phase.toLowerCase()}`, 'lib-progress__now'))

    const bar = document.createElement('div')
    bar.className = 'lib-progress'
    const fill = document.createElement('div')
    fill.className = 'lib-progress__fill'
    fill.style.width = `${Math.round((done.length / current.total) * 100)}%`
    bar.append(fill)
    body.append(bar)

    for (const outcome of done.slice(-12).reverse()) {
      const mark = outcome.status === 'imported' ? '✓' : outcome.status === 'duplicate' ? '=' : '✕'
      body.append(para(`${mark} ${outcome.name}${outcome.detail ? ` — ${outcome.detail}` : ''}`, `lib-report__line is-${outcome.status}`))
    }
  }

  input.addEventListener('change', async () => {
    const files = [...(input.files ?? [])]
    input.value = '' // so re-picking the same file fires change again
    if (files.length === 0) return

    busy = true
    const done: ImportOutcome[] = []
    let latest = { index: 0, total: files.length, name: files[0]?.name ?? '', phase: 'Reading' }
    renderProgress(latest, done)

    const results = await importVideos(
      files,
      (progress) => {
        latest = progress
        renderProgress(latest, done)
      },
      (outcome) => {
        done.push(outcome)
        renderProgress(latest, done)
      },
    )

    busy = false
    lastOutcomes = results
    await refresh()
  })

  sheet = openSheet('Video library', (body) => {
    body.append(para('Loading the library', 'lib-empty'))
  }, () => {
    releasePosters()
    input.remove()
    onClosed?.()
  })

  void refresh()
}
