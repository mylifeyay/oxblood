import primerUrl from '../assets/primer.mp4'
import type { TierKind } from '../game/ledger.ts'
import { bumpTimesPlayed, getVideoBlob, listVideos, type VideoMeta } from '../game/videos.ts'
import { CLIP_SECONDS, describeSlice, pickSlice, pickVideo, poolFor, type Slice } from '../game/bonus.ts'
import type { Sound } from '../audio/sound.ts'

const TIER_NAME: Record<TierKind, string> = { mini: 'Mini', minor: 'Minor', major: 'Major' }
/** Major gets a longer wipe and a held beat before the picture starts. */
const IRIS_MS: Record<TierKind, number> = { mini: 420, minor: 560, major: 900 }
const HELD_BEAT_MS: Record<TierKind, number> = { mini: 0, minor: 120, major: 620 }
/** Major's counter is still climbing when the clip ends. */
const COUNT_MS: Record<TierKind, number> = { mini: 2200, minor: 5200, major: 18000 }
const CARD_MS = 2600
const LOAD_TIMEOUT_MS = 15_000
/** How often the watchdog checks that the picture is still moving. */
const STALL_CHECK_MS = 2000
/**
 * Consecutive checks with no progress before the clip is given up on. Reading a
 * large blob out of IndexedDB and seeking deep into it can genuinely stall for
 * a few seconds on a phone, so the first strike nudges rather than quits.
 */
const STALL_STRIKES = 4
/** How long to wait for a decoded frame after a seek before revealing anyway. */
const FRAME_WAIT_MS = 900

interface Ready {
  meta: VideoMeta
  url: string
  slice: Slice
}

/**
 * The bonus reveal.
 *
 * The order matters more than anything else here: seek first, wait for the
 * `seeked` event, and only then open the iris. Revealing before the seek
 * resolves shows a black frame or the wrong frame for a beat, which ruins it.
 */
export class BonusStage {
  private readonly root: HTMLDivElement
  private readonly iris: HTMLDivElement
  private readonly video: HTMLVideoElement
  private readonly tierLabel: HTMLDivElement
  private readonly counter: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly notice: HTMLDivElement
  private readonly random: () => number
  private readonly sound: Sound

  private primed = false
  private unlocked = false
  private priming: Promise<void> = Promise.resolve()
  private ready: Ready | null = null
  private loading: Promise<void> | null = null
  private running = false

  constructor(random: () => number, sound: Sound) {
    this.random = random
    this.sound = sound

    this.root = document.createElement('div')
    this.root.className = 'bonus'
    this.root.hidden = true

    this.iris = document.createElement('div')
    this.iris.className = 'bonus__iris'

    this.video = document.createElement('video')
    this.video.className = 'bonus__video'
    // Without playsinline iOS hijacks this into its own fullscreen player.
    this.video.playsInline = true
    this.video.setAttribute('playsinline', '')
    this.video.setAttribute('webkit-playsinline', '')
    this.video.preload = 'auto'
    this.iris.append(this.video)

    this.tierLabel = document.createElement('div')
    this.tierLabel.className = 'bonus__tier'

    this.counter = document.createElement('div')
    this.counter.className = 'bonus__counter'

    this.card = document.createElement('div')
    this.card.className = 'bonus__card'

    this.notice = document.createElement('div')
    this.notice.className = 'bonus__notice'
    this.notice.hidden = true

    const topScrim = document.createElement('div')
    topScrim.className = 'bonus__scrim bonus__scrim--top'
    const bottomScrim = document.createElement('div')
    bottomScrim.className = 'bonus__scrim bonus__scrim--bottom'

    this.root.append(this.iris, topScrim, bottomScrim, this.tierLabel, this.counter, this.card, this.notice)
    document.body.append(this.root)
  }

  /**
   * Called on the spin tap. iOS only grants a media element permission to make
   * noise inside a user gesture, and the reveal is seconds too late for that,
   * so a silent placeholder is played and paused here to unlock the element.
   */
  prime(): void {
    if (this.primed) return
    this.primed = true
    this.priming = (async () => {
      const el = this.video
      el.muted = false
      el.src = primerUrl
      el.load()
      try {
        // play() must be reached synchronously from the gesture, so nothing
        // may be awaited above this line.
        await el.play()
        el.pause()
        el.currentTime = 0
        this.unlocked = true
      } catch {
        // Refused. The reveal falls back to a muted clip rather than none.
        this.unlocked = false
      }
    })()
  }

  private once(event: string, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = (act: () => void): void => {
        clearTimeout(timer)
        this.video.removeEventListener(event, ok)
        this.video.removeEventListener('error', bad)
        act()
      }
      const ok = (): void => done(resolve)
      const bad = (): void => done(() => reject(new Error('clip could not be decoded')))
      const timer = setTimeout(() => done(() => reject(new Error('clip took too long'))), ms)
      this.video.addEventListener(event, ok, { once: true })
      this.video.addEventListener('error', bad, { once: true })
    })
  }

  private release(): void {
    if (!this.ready) return
    URL.revokeObjectURL(this.ready.url)
    this.ready = null
  }

  /**
   * Loads a candidate and seeks it while the reels are still turning, so the
   * reveal is instant. Safe to call and ignore.
   */
  async prefetch(kind: TierKind): Promise<void> {
    // The spin kicks this off and the reveal may ask for it again a moment
    // later. Without sharing the in-flight promise the second call would
    // release the first one's clip mid-seek and leak its object URL.
    this.loading ??= this.load(kind).finally(() => {
      this.loading = null
    })
    return this.loading
  }

  private async load(kind: TierKind): Promise<void> {
    await this.priming
    this.release()

    const videos = await listVideos()
    const pick = pickVideo(poolFor(videos, kind), this.random)
    if (!pick) return

    const blob = await getVideoBlob(pick.id)
    if (!blob) return

    const url = URL.createObjectURL(blob)
    const el = this.video
    el.src = url
    el.load()

    try {
      await this.once('loadedmetadata', LOAD_TIMEOUT_MS)
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : pick.duration
      // A fresh offset every single time. Never cached per clip.
      const slice = pickSlice(duration, this.random, CLIP_SECONDS[kind])
      el.currentTime = slice.offset
      await this.once('seeked', LOAD_TIMEOUT_MS)
      // `seeked` only means the seek finished, not that a frame is ready to
      // show. Revealing here is what produces the occasional black screen.
      await this.awaitFrame()
      this.ready = { meta: pick, url, slice }
    } catch {
      URL.revokeObjectURL(url)
      this.ready = null
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Waits until there is genuinely a decoded frame to show.
   *
   * readyState reaching HAVE_CURRENT_DATA means the frame at the current time
   * is available; requestVideoFrameCallback confirms one has actually been
   * presented. Both are capped, so a device that never reports either still
   * gets its reveal, just with the old risk of a black first frame.
   */
  private async awaitFrame(): Promise<void> {
    const el = this.video

    if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await Promise.race([
        new Promise<void>((resolve) => el.addEventListener('loadeddata', () => resolve(), { once: true })),
        this.wait(FRAME_WAIT_MS),
      ])
    }

    const request = (el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })
      .requestVideoFrameCallback
    if (typeof request === 'function') {
      await Promise.race([
        new Promise<void>((resolve) => request.call(el, () => resolve())),
        this.wait(FRAME_WAIT_MS),
      ])
    }
  }

  private countUp(target: number, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(safety)
        this.counter.textContent = String(target)
        resolve()
      }

      const started = performance.now()
      const step = (now: number): void => {
        if (done) return
        const t = Math.min((now - started) / ms, 1)
        const eased = 1 - (1 - t) * (1 - t)
        this.counter.textContent = String(Math.round(target * eased))
        if (t < 1) requestAnimationFrame(step)
        else finish()
      }

      // iOS suspends requestAnimationFrame the moment the app is backgrounded.
      // Without this the count would never finish and the reveal would hold the
      // controls locked for as long as the app stayed in the background.
      const safety = setTimeout(finish, ms * 2 + 2000)
      requestAnimationFrame(step)
    })
  }

  private playClip(ready: Ready): Promise<void> {
    const el = this.video
    const end = ready.slice.offset + ready.slice.length

    return (async () => {
      el.muted = !this.unlocked
      try {
        await el.play()
      } catch {
        // Unmuted playback refused after all — take the picture without sound
        // rather than showing nothing.
        el.muted = true
        try {
          await el.play()
        } catch {
          // Nothing will play. Fall through so the card and the count still
          // happen rather than holding a black screen.
          return
        }
      }

      await new Promise<void>((resolve) => {
        let finished = false
        let ending = false

        const finish = (): void => {
          if (finished) return
          finished = true
          ending = true
          clearInterval(watchdog)
          clearTimeout(hardCap)
          el.removeEventListener('timeupdate', onTime)
          el.removeEventListener('ended', finish)
          el.removeEventListener('pause', onPause)
          el.pause()
          resolve()
        }

        // timeupdate is the cut.
        const onTime = (): void => {
          if (el.currentTime >= end) finish()
        }

        /**
         * A pause we did not ask for.
         *
         * Browsers stop playback of their own accord — a silent video in a
         * backgrounded tab, memory pressure, a reclaimed decoder. Left alone
         * the picture simply freezes and the reveal sits there, which is the
         * freeze this was reported as. Start it again.
         */
        const onPause = (): void => {
          if (ending || el.currentTime >= end) return
          void el.play().catch(() => {})
        }

        el.addEventListener('timeupdate', onTime)
        el.addEventListener('ended', finish)
        el.addEventListener('pause', onPause)

        // The backstop watches for progress rather than counting wall clock.
        // A plain timer cuts the clip short whenever playback runs slower than
        // real time, and drifts long when iOS suspends it.
        //
        // A stall is not automatically fatal: seeking deep into a large blob
        // can genuinely take a few seconds. The early strikes try to get it
        // moving again; only sustained silence ends the clip.
        let lastSeen = el.currentTime
        let strikes = 0
        const watchdog = setInterval(() => {
          if (el.currentTime > lastSeen + 0.05) {
            lastSeen = el.currentTime
            strikes = 0
            return
          }
          strikes++
          if (strikes >= STALL_STRIKES) {
            finish()
            return
          }
          void el.play().catch(() => {})
        }, STALL_CHECK_MS)

        // And a ceiling, so a clip that somehow never stalls and never reaches
        // the end cannot hold the screen forever.
        const hardCap = setTimeout(finish, ready.slice.length * 3000 + 8000)
      })
    })()
  }

  /** Plays the whole reveal. Resolves once it has closed. */
  async reveal(kind: TierKind, payout: number): Promise<void> {
    // One reveal owns the screen at a time. Two overlapping ones would fight
    // over the same video element and leave the tier label showing whichever
    // wrote last, which need not be the one that is paying.
    if (this.running) return
    this.running = true
    try {
      await this.runReveal(kind, payout)
    } finally {
      this.running = false
    }
  }

  private async runReveal(kind: TierKind, payout: number): Promise<void> {
    await this.priming
    if (!this.ready) await this.prefetch(kind)
    const ready = this.ready

    this.tierLabel.textContent = TIER_NAME[kind]
    this.tierLabel.className = `bonus__tier is-${kind}`
    this.counter.textContent = '0'
    this.card.textContent = ''
    this.card.classList.remove('is-in')
    this.notice.hidden = true
    this.root.style.setProperty('--iris-ms', `${IRIS_MS[kind]}ms`)
    this.root.hidden = false
    void this.root.offsetHeight // commit the closed state before opening
    this.root.classList.add('is-open')
    this.sound.bonus(kind)

    let skip = (): void => {}
    const skipped = new Promise<void>((resolve) => {
      skip = resolve
    })
    const onTap = (): void => {
      this.video.pause()
      skip()
    }
    this.root.addEventListener('click', onTap)
    const race = (p: Promise<unknown>): Promise<unknown> => Promise.race([p, skipped])

    const counting = this.countUp(payout, COUNT_MS[kind])

    if (!ready) {
      this.notice.hidden = false
      this.notice.textContent = 'No clips yet. Import some from the menu and the next bonus will play one.'
      await race(this.wait(Math.max(COUNT_MS[kind], 2400)))
    } else {
      if (HELD_BEAT_MS[kind] > 0) await race(this.wait(HELD_BEAT_MS[kind]))
      // The clip has its own sound; the machine goes quiet behind it.
      this.sound.setDucked(true)
      await race(this.playClip(ready))
      this.sound.setDucked(false)

      const at = describeSlice(ready.slice.offset)
      this.card.textContent = `${at} of ${ready.meta.name}`
      this.card.classList.add('is-in')
      void bumpTimesPlayed(ready.meta.id)
      await race(this.wait(CARD_MS))
    }

    await race(counting)
    this.counter.textContent = String(payout)

    this.sound.setDucked(false)
    this.root.removeEventListener('click', onTap)
    this.root.classList.remove('is-open')
    await this.wait(220)
    this.root.hidden = true
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    this.release()
  }
}
