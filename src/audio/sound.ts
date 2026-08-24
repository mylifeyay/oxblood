import type { TierKind } from '../game/ledger.ts'
import type { SoundProfile } from '../ui/skins.ts'

export type WinTier = 'small' | 'medium' | 'big'

export interface Riser {
  stop(): void
}

const SILENT_RISER: Riser = { stop() {} }

/**
 * Everything is synthesised. One AudioContext, created on the first tap of the
 * spin button, because iOS will not make a sound before a user gesture.
 */
export class Sound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bus: GainNode | null = null
  private noise: AudioBuffer | null = null
  private muted = false
  private voice: SoundProfile

  constructor(voice: SoundProfile) {
    this.voice = voice
  }

  /** Swaps the instrument without disturbing the context or the mute state. */
  setVoice(voice: SoundProfile): void {
    this.voice = voice
  }

  get isMuted(): boolean {
    return this.muted
  }

  /** Must be called from inside a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }

    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    const ctx = new Ctor()
    const master = ctx.createGain()
    const bus = ctx.createGain()
    master.gain.value = this.muted ? 0 : 1
    bus.gain.value = 1
    bus.connect(master)
    master.connect(ctx.destination)

    // One second of white noise, reused for every click and clack.
    const frames = Math.floor(ctx.sampleRate * 0.5)
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) channel[i] = Math.random() * 2 - 1

    this.ctx = ctx
    this.master = master
    this.bus = bus
    this.noise = buffer
    void ctx.resume()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (!this.ctx || !this.master) return
    this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02)
  }

  /** Drops the game to silence while a bonus clip is playing. */
  setDucked(ducked: boolean): void {
    if (!this.ctx || !this.bus) return
    this.bus.gain.setTargetAtTime(ducked ? 0 : 1, this.ctx.currentTime, 0.06)
  }

  private note(
    frequency: number,
    { at = 0, length = 0.18, gain = 0.07, type = 'triangle' as OscillatorType, glide = 0 },
  ): void {
    const ctx = this.ctx
    if (!ctx || !this.bus) return
    const start = ctx.currentTime + at

    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(frequency, start)
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + glide), start + length)

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, start)
    env.gain.exponentialRampToValueAtTime(gain, start + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, start + length)

    osc.connect(env)
    env.connect(this.bus)
    osc.start(start)
    osc.stop(start + length + 0.05)
  }

  private clack(frequency: number, length: number, gain: number): void {
    const ctx = this.ctx
    if (!ctx || !this.bus || !this.noise) return
    const start = ctx.currentTime

    const source = ctx.createBufferSource()
    source.buffer = this.noise
    source.playbackRate.value = 1.6

    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = frequency
    band.Q.value = 1.4

    const env = ctx.createGain()
    env.gain.setValueAtTime(gain, start)
    env.gain.exponentialRampToValueAtTime(0.0001, start + length)

    source.connect(band)
    band.connect(env)
    env.connect(this.bus)
    source.start(start)
    source.stop(start + length + 0.02)
  }

  /** The clack of a reel coming to rest. Slightly lower for each reel. */
  reelStop(index: number): void {
    const v = this.voice
    this.clack(v.clackHz - index * (v.clackHz * 0.087), v.clackDecay, 0.16)
    this.note(v.thumpHz - index * 6, { length: 0.07, gain: 0.05, type: 'sine' })
  }

  /** One tick per increment of the credit meter, rising as it climbs. */
  coinTick(progress: number): void {
    const v = this.voice
    this.note(v.tickBase + progress * v.tickSpread, { length: 0.045, gain: 0.045, type: v.chime })
  }

  /** The tone that rises while an anticipating reel is still turning. */
  startRiser(seconds: number): Riser {
    const ctx = this.ctx
    if (!ctx || !this.bus) return SILENT_RISER
    const start = ctx.currentTime
    const v = this.voice

    const osc = ctx.createOscillator()
    osc.type = v.riserType
    osc.frequency.setValueAtTime(v.riserFrom, start)
    osc.frequency.exponentialRampToValueAtTime(v.riserTo, start + seconds)

    const lift = ctx.createBiquadFilter()
    lift.type = 'lowpass'
    lift.frequency.setValueAtTime(700, start)
    lift.frequency.exponentialRampToValueAtTime(4200, start + seconds)
    lift.Q.value = 6

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, start)
    env.gain.exponentialRampToValueAtTime(0.06, start + 0.18)

    osc.connect(lift)
    lift.connect(env)
    env.connect(this.bus)
    osc.start(start)

    let stopped = false
    return {
      stop: () => {
        if (stopped) return
        stopped = true
        const now = ctx.currentTime
        env.gain.cancelScheduledValues(now)
        env.gain.setValueAtTime(Math.max(env.gain.value, 0.0001), now)
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
        osc.stop(now + 0.16)
      },
    }
  }

  /** Win chimes, pitched and lengthened by tier. */
  win(tier: WinTier): void {
    const v = this.voice
    const run = tier === 'small' ? v.smallRun : tier === 'medium' ? v.mediumRun : v.bigRun
    const step = tier === 'small' ? 0.075 : tier === 'medium' ? 0.09 : 0.1
    const length = tier === 'small' ? 0.15 : tier === 'medium' ? 0.26 : 0.42
    run.forEach((f, i) => this.note(f, { at: i * step, length, gain: 0.06, type: v.chime }))
    if (tier === 'big') this.note(run[0]! / 2, { at: 0.1, length: 1.1, gain: 0.045, type: 'sine' })
  }

  /** The fanfare as the iris opens, in the character of its tier. */
  bonus(kind: TierKind): void {
    const { notes, type, length } = this.voice.bonusRuns[kind]
    const step = length * 0.26
    notes.forEach((f, i) => this.note(f, { at: i * step, length, gain: 0.055, type }))
    if (kind === 'major') {
      this.note(notes[0]! / 2, { at: 0, length: 1.8, gain: 0.05, type: 'sine' })
      this.note(notes[1] ?? notes[0]!, { at: 0.55, length: 1.4, gain: 0.04, type: 'sine' })
    }
  }
}
