import type { TierKind } from './ledger.ts'
import type { Tier, VideoMeta } from './videos.ts'

/** How much video each tier plays, unless the clip is shorter than that. */
export const CLIP_SECONDS: Record<TierKind, number> = {
  mini: 10,
  minor: 15,
  major: 30,
}

/** Which pool each win tier draws from. */
export const TIER_POOL: Record<TierKind, Tier> = {
  mini: 'common',
  minor: 'rare',
  major: 'legendary',
}

/**
 * The pool for a tier, falling through so a bonus can never fail for want of
 * tagging: the exact tier first, then Common, then anything at all. The money
 * pays either way — this only decides which clip runs.
 */
export function poolFor(videos: readonly VideoMeta[], kind: TierKind): VideoMeta[] {
  const wanted = TIER_POOL[kind]
  const exact = videos.filter((v) => v.tier === wanted)
  if (exact.length > 0) return exact
  const common = videos.filter((v) => v.tier === 'common')
  if (common.length > 0) return common
  return [...videos]
}

/**
 * Weighted inversely by how often a clip has already played, so the library
 * spreads out instead of returning to the same favourite.
 */
export function pickVideo(pool: readonly VideoMeta[], random: () => number): VideoMeta | null {
  if (pool.length === 0) return null

  const weights = pool.map((v) => 1 / (1 + Math.max(0, v.timesPlayed)))
  const total = weights.reduce((a, b) => a + b, 0)
  let ticket = random() * total

  for (let i = 0; i < pool.length; i++) {
    ticket -= weights[i]!
    if (ticket <= 0) return pool[i]!
  }
  return pool[pool.length - 1]!
}

export interface Slice {
  /** Seconds into the clip where playback starts. */
  offset: number
  /** How long to play for. */
  length: number
}

/**
 * Picks the ten-second window.
 *
 * Skipping the outer 5% avoids intros, shaky openings and fade-outs. A fresh
 * offset is rolled every single time — an hour-long video holds 360 distinct
 * moments and the not-knowing is the entire point, so nothing is cached here.
 */
export function pickSlice(duration: number, random: () => number, length: number): Slice {
  if (!Number.isFinite(duration) || duration <= 0) return { offset: 0, length }

  // Shorter than the window: play the whole thing.
  if (duration <= length) return { offset: 0, length: duration }

  const usableStart = 0.05 * duration
  const usableEnd = 0.95 * duration - length

  if (usableEnd > usableStart) {
    return { offset: usableStart + random() * (usableEnd - usableStart), length }
  }

  // Barely longer than the window, so trimming the ends leaves nothing. Use the
  // whole clip rather than refusing to pick.
  const latest = duration - length
  return { offset: latest > 0 ? random() * latest : 0, length }
}

/** "0:42 of Dinner in Ibiza" — where in the clip that moment came from. */
export function describeSlice(offset: number): string {
  const total = Math.max(0, Math.floor(offset))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
