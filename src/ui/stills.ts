import { getVideoBlob, listUnlocked, setPoster } from '../game/videos.ts'
import { posterIsBlank, recapturePoster } from '../game/poster.ts'

/** Enough for a board to look varied without holding a gallery in memory. */
const MAX = 12

/**
 * Poster frames from clips the machine has actually played, kept as object URLs
 * for the reels to wear.
 *
 * A clip qualifies once it has been screened — the same test the unlocked
 * gallery uses. Nothing here changes what a symbol is worth; the wild is still
 * the wild, and only its face changes.
 *
 * A poster with no picture in it is dropped rather than shown. A black square
 * on a reel reads as a broken tile, and the plain wild face is better than
 * that. Where the clip itself has a picture somewhere — which is most of them,
 * since the old capture gave up after two samples and kept whatever it had —
 * a fresh frame is pulled from the video in the background and saved, so the
 * clip joins the reels on the next refresh and stays fixed thereafter.
 */
export class Stills {
  private urls: string[] = []
  /** Which clips the current set was built from, so an unchanged set is left alone. */
  private key = ''
  /** Clips already put through repair, so a hopeless one is not retried. */
  private readonly repaired = new Set<string>()
  private repairing = false
  /** Set when a repair lands, so the next refresh rebuilds despite the same ids. */
  private dirty = false
  /** Called when a repaired poster is ready to go on the reels. */
  onRepaired: (() => void) | null = null

  get list(): readonly string[] {
    return this.urls
  }

  /** Rebuilds the set. Returns true when the reels need redrawing. */
  async refresh(): Promise<boolean> {
    let clips
    try {
      clips = await listUnlocked()
    } catch {
      // A device that will not open the library still deals cards.
      return false
    }

    const key = clips.map((c) => c.id).join(',')
    if (key === this.key && !this.dirty) return false
    this.key = key
    this.dirty = false

    const usable: Blob[] = []
    const broken: string[] = []
    for (const clip of clips) {
      if (usable.length >= MAX) break
      if (await posterIsBlank(clip.poster)) broken.push(clip.id)
      else usable.push(clip.poster)
    }

    const next = usable.map((poster) => URL.createObjectURL(poster))
    this.release()
    this.urls = next

    const toRepair = broken.filter((id) => !this.repaired.has(id))
    if (toRepair.length > 0) void this.repair(toRepair)
    return true
  }

  /**
   * Pulls a fresh frame for clips whose stored poster is blank.
   *
   * Runs on its own, after the reels have already been dressed with whatever
   * was usable — decoding a video to find a frame takes long enough that
   * waiting for it would hold up the first spin.
   */
  private async repair(ids: readonly string[]): Promise<void> {
    if (this.repairing) return
    this.repairing = true
    let fixed = false
    try {
      for (const id of ids) {
        this.repaired.add(id)
        try {
          const blob = await getVideoBlob(id)
          if (!blob) continue
          const poster = await recapturePoster(blob)
          if (poster && !(await posterIsBlank(poster))) {
            await setPoster(id, poster)
            fixed = true
          }
        } catch {
          // A clip that will not give up a frame keeps the face it has.
        }
      }
    } finally {
      this.repairing = false
    }
    if (fixed) {
      this.dirty = true
      this.onRepaired?.()
    }
  }

  release(): void {
    for (const url of this.urls) URL.revokeObjectURL(url)
    this.urls = []
  }
}
