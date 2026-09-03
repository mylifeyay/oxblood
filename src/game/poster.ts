/**
 * Poster frames.
 *
 * A poster stands in for its clip everywhere the video itself is too heavy to
 * show: the library grid, the unlocked gallery, and the face of the wild. A
 * black one is worse than useless in all three, so the job here is to come back
 * with a frame that actually has a picture in it.
 */

const SEEK_TIMEOUT_MS = 25_000
const METADATA_TIMEOUT_MS = 25_000
const MAX_EDGE = 360
const QUALITY = 0.72

/**
 * Where to look, in order.
 *
 * A tenth of the way in clears titles and fade-ups and is right nearly every
 * time, so it is tried first and the search usually stops there. The rest are
 * spread across the clip because the failure this is guarding against is a
 * whole dark opening — a night shot, a slow fade, a lens cap — and two samples
 * a quarter apart both land inside one.
 */
const SAMPLE_POINTS = [0.1, 0.35, 0.6, 0.85, 0.22, 0.47, 0.72, 0.95]

export interface FrameScore {
  readonly mean: number
  readonly variance: number
}

/** Mean luminance and its variance, sampled sparsely. */
export function scoreFrame(ctx: CanvasRenderingContext2D, width: number, height: number): FrameScore {
  const { data } = ctx.getImageData(0, 0, width, height)
  let sum = 0
  let sumSquares = 0
  let n = 0
  // Every 40th pixel is plenty to tell black from a picture.
  for (let i = 0; i < data.length; i += 4 * 40) {
    const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    sum += lum
    sumSquares += lum * lum
    n++
  }
  if (n === 0) return { mean: 0, variance: 0 }
  const mean = sum / n
  return { mean, variance: sumSquares / n - mean * mean }
}

/**
 * True when a frame is essentially a black rectangle.
 *
 * Both terms are needed. A dark but real picture has low mean and high
 * variance; a flat grey card has middling mean and no variance. Only something
 * that is both dark and featureless is worth rejecting.
 */
export const looksBlank = (score: FrameScore): boolean => score.mean < 10 && score.variance < 8

/** How good a frame is as a poster. Brightness matters, but detail matters more. */
const rank = (score: FrameScore): number => score.mean + Math.sqrt(score.variance) * 4

/**
 * Grabs the best poster frame it can find from an already-loaded video.
 *
 * Stops at the first frame that is not blank, so an ordinary clip costs exactly
 * one seek. When every sample is blank it keeps the least bad of them rather
 * than whichever happened to be last — which is what used to store a black
 * rectangle for any clip that opened dark.
 */
export async function capturePoster(
  video: HTMLVideoElement,
  duration: number,
  width: number,
  height: number,
): Promise<Blob> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('this device would not open a canvas for the poster')

  let best: { rank: number; data: ImageData } | null = null

  for (const fraction of SAMPLE_POINTS) {
    const at = Math.min(duration * fraction, Math.max(0, duration - 0.05))
    try {
      await seekTo(video, at)
    } catch {
      // A seek that will not land is not fatal — take what has been found.
      break
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const score = scoreFrame(ctx, canvas.width, canvas.height)
    if (!looksBlank(score)) {
      best = null
      break
    }
    const here = rank(score)
    if (!best || here > best.rank) best = { rank: here, data: ctx.getImageData(0, 0, canvas.width, canvas.height) }
  }

  // `best` is only set while every sample so far has been blank; the loop
  // clears it the moment it finds a real frame and leaves that one on the
  // canvas.
  if (best) ctx.putImageData(best.data, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (!blob) throw new Error('the poster frame could not be encoded')
  return blob
}

/** True when a stored poster has no picture in it. */
export async function posterIsBlank(poster: Blob): Promise<boolean> {
  const url = URL.createObjectURL(poster)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = 48
    canvas.height = 48
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return looksBlank(scoreFrame(ctx, canvas.width, canvas.height))
  } catch {
    // A poster that will not decode is no use on a reel either.
    return true
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Re-derives a poster from the clip itself, for one stored badly. */
export async function recapturePoster(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.defaultMuted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.setAttribute('muted', '')
  video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none'
  document.body.append(video)

  try {
    video.src = url
    video.load()
    await once(video, 'loadedmetadata', METADATA_TIMEOUT_MS, 'took too long to read')
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) return null
    if (!video.videoWidth || !video.videoHeight) return null
    return await capturePoster(video, duration, video.videoWidth, video.videoHeight)
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
    video.remove()
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('poster would not decode'))
    img.src = url
  })
}

export function once(video: HTMLVideoElement, event: string, ms: number, timeoutMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (act: () => void): void => {
      clearTimeout(timer)
      video.removeEventListener(event, ok)
      video.removeEventListener('error', bad)
      act()
    }
    const ok = (): void => finish(resolve)
    const bad = (): void => finish(() => reject(new Error('could not be decoded')))
    const timer = setTimeout(() => finish(() => reject(new Error(timeoutMessage))), ms)
    video.addEventListener(event, ok, { once: true })
    video.addEventListener('error', bad, { once: true })
  })
}

export async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return
  const settled = once(video, 'seeked', SEEK_TIMEOUT_MS, 'took too long to seek')
  video.currentTime = time
  await settled
}
