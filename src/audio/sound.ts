import type { TierKind } from '../game/ledger.ts'

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
    this.clack(1500 - index * 130, 0.055, 0.16)
    this.note(120 - index * 6, { length: 0.07, gain: 0.05, type: 'sine' })
  }

  /** One tick per increment of the credit meter, rising as it climbs. */
  coinTick(progress: number): void {
    this.note(760 + progress * 900, { length: 0.045, gain: 0.045, type: 'triangle' })
  }

  /** The tone that rises while an anticipating reel is still turning. */
  startRiser(seconds: number): Riser {
    const ctx = this.ctx
    if (!ctx || !this.bus) return SILENT_RISER
    const start = ctx.currentTime

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(190, start)
    osc.frequency.exponentialRampToValueAtTime(920, start + seconds)

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
    if (tier === 'small') {
      this.note(1046, { length: 0.13, gain: 0.06 })
      this.note(1318, { at: 0.075, length: 0.16, gain: 0.055 })
      return
    }
    if (tier === 'medium') {
      const run = [1046, 1318, 1568]
      run.forEach((f, i) => this.note(f, { at: i * 0.09, length: 0.26, gain: 0.06 }))
      return
    }
    const run = [784, 1046, 1318, 1568, 2093]
    run.forEach((f, i) => this.note(f, { at: i * 0.1, length: 0.42, gain: 0.06 }))
    this.note(392, { at: 0.1, length: 1.1, gain: 0.045, type: 'sine' })
  }

  /** The fanfare as the iris opens, in the character of its tier. */
  bonus(kind: TierKind): void {
    if (kind === 'mini') {
      ;[523, 659, 784].forEach((f, i) => this.note(f, { at: i * 0.075, length: 0.28, gain: 0.06, type: 'square' }))
      return
    }
    if (kind === 'minor') {
      ;[659, 880, 1046, 1318].forEach((f, i) => this.note(f, { at: i * 0.085, length: 0.36, gain: 0.055 }))
      return
    }
    ;[261, 392, 523, 659, 784, 1046].forEach((f, i) => this.note(f, { at: i * 0.11, length: 0.7, gain: 0.055 }))
    this.note(130, { at: 0, length: 1.8, gain: 0.05, type: 'sine' })
    this.note(196, { at: 0.55, length: 1.4, gain: 0.04, type: 'sine' })
  }
}
