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

export async function bumpTimesPlayed(id: string): Promise<void> {
  const db = await database()
  if (!db) return
  const tx = db.transaction('videos', 'readwrite')
  const meta = await tx.store.get(id)
  if (meta) void tx.store.put({ ...meta, timesPlayed: meta.timesPlayed + 1 })
  await tx.done
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
