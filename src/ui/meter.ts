/**
 * The credit meter.
 *
 * Wins roll up rather than jumping, digit by digit, with a tick per increment.
 * It is the one readout on the machine that should feel mechanical.
 */
export class CreditMeter {
  private readonly el: HTMLElement
  private readonly onTick: (progress: number) => void
  private value = 0
  private token = 0

  constructor(el: HTMLElement, onTick: (progress: number) => void) {
    this.el = el
    this.onTick = onTick
  }

  get current(): number {
    return this.value
  }

  set(value: number): void {
    this.token++
    this.value = value
    this.el.textContent = String(value)
    this.el.classList.remove('is-rolling')
  }

  /** Rolls to `value` over `ms`, ticking as it climbs. */
  rollTo(value: number, ms: number): Promise<void> {
    const from = this.value
    const delta = value - from
    if (delta === 0 || ms <= 0) {
      this.set(value)
      return Promise.resolve()
    }

    const mine = ++this.token
    this.el.classList.add('is-rolling')

    return new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(safety)
        if (this.token === mine) {
          this.value = value
          this.el.textContent = String(value)
          this.el.classList.remove('is-rolling')
        }
        resolve()
      }

      // About fourteen ticks a second, whatever the amount. A thousand-credit
      // win should not fire a thousand clicks.
      const ticks = Math.max(1, Math.round((ms / 1000) * 14))
      let lastTick = -1
      const started = performance.now()

      const step = (now: number): void => {
        if (done || this.token !== mine) return finish()
        const t = Math.min((now - started) / ms, 1)
        const eased = 1 - (1 - t) * (1 - t)
        const shown = Math.round(from + delta * eased)
        if (shown !== this.value) {
          this.value = shown
          this.el.textContent = String(shown)
        }
        const tick = Math.floor(t * ticks)
        if (tick !== lastTick) {
          lastTick = tick
          this.onTick(t)
        }
        if (t < 1) requestAnimationFrame(step)
        else finish()
      }

      // iOS suspends requestAnimationFrame in the background; without this the
      // meter could be left mid-roll showing the wrong balance.
      const safety = setTimeout(finish, ms * 2 + 2000)
      requestAnimationFrame(step)
    })
  }
}
