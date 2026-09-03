import { sha256 } from './sha256.ts'
import { capturePoster, once } from './poster.ts'
import { findByFingerprint, saveVideo, type VideoMeta } from './videos.ts'

const METADATA_TIMEOUT_MS = 25_000
/** The brief's fingerprint: SHA-256 of the first megabyte, plus size and duration. */
const FINGERPRINT_BYTES = 1024 * 1024

export const ACCEPT = 'video/*,.mp4,.mov,.m4v'

export type ImportStatus = 'imported' | 'duplicate' | 'failed'

export interface ImportOutcome {
  name: string
  status: ImportStatus
  detail: string
}

export interface ImportProgress {
  index: number
  total: number
  name: string
  phase: string
}

/** crypto.randomUUID needs a secure context, which plain HTTP on the LAN is not. */
function newId(): string {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c) return c.randomUUID()
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

interface Read {
  duration: number
  width: number
  height: number
  poster: Blob
}

/**
 * Loads the blob into an offscreen video and reads it properly. The extension
 * is not trusted for anything: if this cannot get metadata and a frame out of
 * the file, it is not going in the library.
 */
async function readVideo(file: File): Promise<Read> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.defaultMuted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.setAttribute('muted', '')
  // Attached but invisible: iOS decodes far more reliably for an element that
  // is actually in the document.
  video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none'
  document.body.append(video)

  try {
    video.src = url
    video.load()
    await once(video, 'loadedmetadata', METADATA_TIMEOUT_MS, 'took too long to read')

    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('has no readable duration')
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) throw new Error('has no video track')

    const poster = await capturePoster(video, duration, width, height)
    return { duration, width, height, poster }
  } finally {
    video.removeAttribute('src')
    video.load()
    video.remove()
    URL.revokeObjectURL(url)
  }
}

async function fingerprintOf(file: File, duration: number): Promise<string> {
  const head = new Uint8Array(await file.slice(0, FINGERPRINT_BYTES).arrayBuffer())
  return `${await sha256(head)}:${file.size}:${duration.toFixed(3)}`
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22)
  )
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Imports a batch. One bad file never costs you the rest of the batch — each
 * is reported on its own and the successes are kept.
 */
export async function importVideos(
  files: readonly File[],
  onProgress: (progress: ImportProgress) => void,
  onOutcome: (outcome: ImportOutcome) => void,
): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = []
  const record = (outcome: ImportOutcome): void => {
    outcomes.push(outcome)
    onOutcome(outcome)
  }

  // Ask once, before writing hundreds of megabytes, so Safari is less likely
  // to evict the library later.
  try {
    await navigator.storage?.persist?.()
  } catch {
    // Not being allowed to ask is not a reason to refuse the import.
  }

  for (const [index, file] of files.entries()) {
    const name = file.name || 'Untitled clip'
    const progress = (phase: string): void => onProgress({ index, total: files.length, name, phase })

    try {
      progress('Reading')
      const read = await readVideo(file)

      progress('Checking for a duplicate')
      const fingerprint = await fingerprintOf(file, read.duration)
      const existing = await findByFingerprint(fingerprint)
      if (existing) {
        record({ name, status: 'duplicate', detail: `already in the library as “${existing.name}”` })
        continue
      }

      progress('Saving')
      const meta: VideoMeta = {
        id: newId(),
        name,
        poster: read.poster,
        duration: read.duration,
        tier: 'common',
        timesPlayed: 0,
        importedAt: Date.now(),
        bytes: file.size,
        fingerprint,
        width: read.width,
        height: read.height,
      }
      await saveVideo(meta, file)
      record({ name, status: 'imported', detail: '' })
    } catch (error) {
      const detail = isQuotaError(error)
        ? 'there is no room left on this device. Delete some clips and try again.'
        : reasonOf(error)
      record({ name, status: 'failed', detail })
    }
  }

  return outcomes
}
