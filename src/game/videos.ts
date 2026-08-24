import { database } from './db.ts'

export type Tier = 'common' | 'rare' | 'legendary'

export const TIERS: readonly Tier[] = ['common', 'rare', 'legendary']

/**
 * Everything about a clip except the clip itself.
 *
 * The video blob lives in a separate store keyed by the same id, so listing the
 * library never has to touch hundreds of megabytes. The poster stays here — it
 * is a few kilobytes and the grid needs every one of them.
 */
export interface VideoMeta {
  id: string
  name: string
  poster: Blob
  /** Seconds. */
  duration: number
  tier: Tier
  timesPlayed: number
  importedAt: number
  /** Size of the video blob, denormalised so totals need no blob reads. */
  bytes: number
  /** SHA-256 of the first megabyte, byte length and duration. */
  fingerprint: string
  width: number
  height: number
  /** Marked with a heart in the unlocked gallery. */
  liked?: boolean
  /**
   * Which fixed-length segments a bonus has actually shown. Winning one slice
   * reveals only the part of the video it played, not the whole file.
   *
   * Absent means the clip predates segment tracking and stays fully unlocked —
   * taking something back that was already given would be worse than the
   * inconsistency.
   */
  unlockedSegments?: number[]
  /** When a bonus last played this clip. Absent means it never has. */
  lastWonAt?: number
}

export async function listVideos(): Promise<VideoMeta[]> {
  const db = await database()
  if (!db) return []
  const all = await db.getAll('videos')
  return all.sort((a, b) => b.importedAt - a.importedAt)
}

export async function getVideoBlob(id: string): Promise<Blob | undefined> {
  const db = await database()
  if (!db) return undefined
  return db.get('videoBlobs', id)
}

export async function findByFingerprint(fingerprint: string): Promise<VideoMeta | undefined> {
  const db = await database()
  if (!db) return undefined
  return db.getFromIndex('videos', 'by-fingerprint', fingerprint)
}

/** Writes metadata and blob together, so a half-imported clip cannot exist. */
export async function saveVideo(meta: VideoMeta, blob: Blob): Promise<void> {
  const db = await database()
  if (!db) throw new Error('this device is not letting the game store anything')
  const tx = db.transaction(['videos', 'videoBlobs'], 'readwrite')
  void tx.objectStore('videos').put(meta)
  void tx.objectStore('videoBlobs').put(blob, meta.id)
  await tx.done
}

export async function deleteVideos(ids: readonly string[]): Promise<void> {
  const db = await database()
  if (!db || ids.length === 0) return
  const tx = db.transaction(['videos', 'videoBlobs'], 'readwrite')
  for (const id of ids) {
    void tx.objectStore('videos').delete(id)
    void tx.objectStore('videoBlobs').delete(id)
  }
  await tx.done
}

export async function setTier(ids: readonly string[], tier: Tier): Promise<void> {
  const db = await database()
  if (!db || ids.length === 0) return
  const tx = db.transaction('videos', 'readwrite')
  for (const id of ids) {
    const meta = await tx.store.get(id)
    if (meta) void tx.store.put({ ...meta, tier })
  }
  await tx.done
}

/**
 * Advances one clip to the next tier, reading the current value inside the same
 * transaction as the write. Deriving "next" from what was on screen instead
 * means a quick double tap computes the same answer twice and one tap is lost.
 */
export async function cycleTier(id: string): Promise<Tier | undefined> {
  const db = await database()
  if (!db) return undefined
  const tx = db.transaction('videos', 'readwrite')
  const meta = await tx.store.get(id)
  if (!meta) {
    await tx.done
    return undefined
  }
  const next = TIERS[(TIERS.indexOf(meta.tier) + 1) % TIERS.length]!
  void tx.store.put({ ...meta, tier: next })
  await tx.done
  return next
}

/**
 * Records that a bonus played this slice, unlocking only the segments it
 * actually showed. Read and written in one transaction.
 */
export async function recordWin(id: string, offset: number, length: number): Promise<void> {
  const db = await database()
  if (!db) return
  const tx = db.transaction('videos', 'readwrite')
  const meta = await tx.store.get(id)
  if (meta) {
    const unlocked = new Set(unlockedOf(meta))
    for (const segment of coveredSegments(offset, length, meta.duration)) unlocked.add(segment)
    void tx.store.put({
      ...meta,
      timesPlayed: meta.timesPlayed + 1,
      lastWonAt: Date.now(),
      unlockedSegments: [...unlocked].sort((a, b) => a - b),
    })
  }
  await tx.done
}

/** Returns the new state, read inside the write so quick taps cannot race. */
export async function toggleLiked(id: string): Promise<boolean> {
  const db = await database()
  if (!db) return false
  const tx = db.transaction('videos', 'readwrite')
  const meta = await tx.store.get(id)
  if (!meta) {
    await tx.done
    return false
  }
  const liked = !meta.liked
  void tx.store.put({ ...meta, liked })
  await tx.done
  return liked
}

/**
 * Clips a bonus has actually played, newest first, hearted ones first.
 * Winning the same clip twice does not list it twice — the count says so.
 */
export async function listUnlocked(): Promise<VideoMeta[]> {
  const all = await listVideos()
  return all
    .filter((v) => v.timesPlayed > 0)
    .sort((a, b) => Number(b.liked ?? false) - Number(a.liked ?? false) || (b.lastWonAt ?? 0) - (a.lastWonAt ?? 0))
}

/** The grain at which a video unlocks. A Mini reveals one or two of these. */
export const SEGMENT_SECONDS = 10

export const segmentCount = (duration: number): number => Math.max(1, Math.ceil(duration / SEGMENT_SECONDS))

/** The segments a slice starting at `offset` and running `length` touches. */
export function coveredSegments(offset: number, length: number, duration: number): number[] {
  const total = segmentCount(duration)
  const first = Math.min(total - 1, Math.max(0, Math.floor(offset / SEGMENT_SECONDS)))
  const last = Math.min(total - 1, Math.max(first, Math.floor((offset + length - 0.001) / SEGMENT_SECONDS)))
  const out: number[] = []
  for (let i = first; i <= last; i++) out.push(i)
  return out
}

/** Unlocked segments, treating pre-segment clips as fully revealed. */
export function unlockedOf(meta: VideoMeta): number[] {
  if (meta.unlockedSegments) return meta.unlockedSegments
  if (meta.timesPlayed > 0) return Array.from({ length: segmentCount(meta.duration) }, (_, i) => i)
  return []
}

export const isFullyUnlocked = (meta: VideoMeta): boolean =>
  unlockedOf(meta).length >= segmentCount(meta.duration)

/** Contiguous runs of unlocked video, in seconds, for playback. */
export function unlockedRuns(meta: VideoMeta): { start: number; end: number }[] {
  const sorted = [...unlockedOf(meta)].sort((a, b) => a - b)
  const runs: { start: number; end: number }[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++
    runs.push({
      start: sorted[i]! * SEGMENT_SECONDS,
      end: Math.min(meta.duration, (sorted[j]! + 1) * SEGMENT_SECONDS),
    })
    i = j + 1
  }
  return runs
}

export const libraryBytes = (videos: readonly VideoMeta[]): number => videos.reduce((total, v) => total + v.bytes, 0)

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}
