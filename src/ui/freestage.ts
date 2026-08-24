import type { Sound } from '../audio/sound.ts'

const CARD_MS = 1900
const FADE_MS = 300

/**
 * The free spin round's furniture.
 *
 * The reels themselves are not owned here — the round plays out on the real
 * cabinet, which is the whole appeal of it. This adds the card that opens the
 * round, the bar that tracks it, and the card that closes it.
 */
export class FreeStage {
  private readonly card: HTMLDivElement
  private readonly cardTitle: HTMLDivElement
  private readonly cardBody: HTMLDivElement
  private readonly tiers: HTMLElement
  private readonly leftEl: HTMLSpanElement
  private readonly multEl: HTMLSpanElement
  private readonly totalEl: HTMLSpanElement
  private readonly flash: HTMLDivElement
  private readonly sound: Sound
  /** The tier signage as it was, put back when the round ends. */
  private readonly signage: Node[]

  /**
   * `tiers` is the Mini/Minor/Major signage above the reels. Nothing can be won
   * from it during a round, so the round borrows it: three cells, already in
   * the right place and already styled, rather than a bar floating over the
   * masthead.
   */
  constructor(sound: Sound, tiers: HTMLElement) {
    this.sound = sound
    this.tiers = tiers
    this.signage = Array.from(tiers.childNodes)

    this.card = document.createElement('div')
    this.card.className = 'freecard'
    this.card.hidden = true
    this.cardTitle = document.createElement('div')
    this.cardTitle.className = 'freecard__title'
    this.cardBody = document.createElement('div')
    this.cardBody.className = 'freecard__body'
    this.card.append(this.cardTitle, this.cardBody)

    this.leftEl = document.createElement('span')
    this.multEl = document.createElement('span')
    this.totalEl = document.createElement('span')

    this.flash = document.createElement('div')
    this.flash.className = 'freeflash'
    this.flash.hidden = true

    document.body.append(this.card, this.flash)
  }

  /** Swaps the tier signage for the round's own three readings. */
  private takeSignage(): void {
    const cells: Node[] = []
    for (const [label, value, extra] of [
      ['Spins', this.leftEl, ''],
      ['Multiplier', this.multEl, ' tier__pay--mult'],
      ['Won', this.totalEl, ''],
    ] as const) {
      const cell = document.createElement('div')
      cell.className = 'tier tier--free'
      const name = document.createElement('span')
      name.className = 'tier__name'
      name.textContent = label
      value.className = `tier__pay${extra}`
      cell.append(name, value)
      cells.push(cell)
    }
    this.tiers.replaceChildren(...cells)
  }

  private giveSignageBack(): void {
    this.tiers.replaceChildren(...this.signage)
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async showCard(title: string, body: string, hold = CARD_MS): Promise<void> {
    this.cardTitle.textContent = title
    this.cardBody.textContent = body
    this.card.hidden = false
    void this.card.offsetHeight
    this.card.classList.add('is-open')
    await this.wait(hold)
    this.card.classList.remove('is-open')
    await this.wait(FADE_MS)
    this.card.hidden = true
  }

  /** Opens the round. */
  async intro(spins: number): Promise<void> {
    this.sound.win('big')
    await this.showCard('Free spins', `${spins} spins, and the multiplier climbs on every win`)
    document.documentElement.classList.add('is-free')
    this.takeSignage()
  }

  update(left: number, multiplier: number, total: number): void {
    this.leftEl.textContent = String(left)
    this.multEl.textContent = String(multiplier)
    this.totalEl.textContent = String(total)
  }

  /** The ratchet. Worth its own beat — it is the reason to keep watching. */
  ratchet(multiplier: number): void {
    this.multEl.textContent = String(multiplier)
    this.multEl.classList.remove('is-up')
    void this.multEl.offsetWidth
    this.multEl.classList.add('is-up')
    this.sound.coinTick(Math.min(1, multiplier / 10))
  }

  /** A retrigger. */
  async award(added: number): Promise<void> {
    this.flash.textContent = `+${added} spins`
    this.flash.hidden = false
    void this.flash.offsetHeight
    this.flash.classList.add('is-open')
    this.sound.win('medium')
    await this.wait(950)
    this.flash.classList.remove('is-open')
    await this.wait(FADE_MS)
    this.flash.hidden = true
  }

  /** Closes the round and takes the room back to normal. */
  async outro(total: number, played: number, multiplier: number): Promise<void> {
    this.giveSignageBack()
    document.documentElement.classList.remove('is-free')
    this.sound.win(total > 0 ? 'big' : 'small')
    const detail = total > 0 ? `${played} spins, finishing at ${multiplier}x` : `${played} spins, nothing doing`
    await this.showCard(total > 0 ? `${total}` : 'No win', detail, 2100)
  }
}
