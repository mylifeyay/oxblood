import { listUnlocked } from '../game/videos.ts'

/** Enough for a board to look varied without holding a gallery in memory. */
const MAX = 12

/**
 * Poster frames from clips the machine has actually played, kept as object URLs
 * for the reels to wear.
 *
 * A clip qualifies once it has been screened — the same test the unlocked
 * gallery uses. Nothing here changes what a symbol is worth; the wild is still
 * the wild, and only its face changes.
 */
export class Stills {
  private urls: string[] = []

  get list(): readonly string[] {
    return this.urls
  }

  /** Rebuilds the set. Returns true when it changed, so callers can skip a redraw. */
  async refresh(): Promise<boolean> {
    let clips
    try {
      clips = await listUnlocked()
    } catch {
      // A device that will not open the library still deals cards.
      return false
    }

    const posters = clips.slice(0, MAX).map((clip) => clip.poster)
    if (posters.length === this.urls.length && posters.length === 0) return false

    const next = posters.map((poster) => URL.createObjectURL(poster))
    this.release()
    this.urls = next
    return true
  }

  release(): void {
    for (const url of this.urls) URL.revokeObjectURL(url)
    this.urls = []
  }
}
