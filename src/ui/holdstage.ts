import type { HoldResult } from '../game/hold.ts'
import type { Sound } from '../audio/sound.ts'

const OPEN_MS = 260
const LOCK_MS = 700
const ROUND_MS = 620
const TOTAL_MS = 1500
const CLOSE_MS = 260

const plural = (n: number): string => `${n} respin${n === 1 ? '' : 's'}`

/**
 * The hold-and-spin board.
 *
 * The feature is already decided when this runs — it is handed the rounds and
 * replays them. Nothing here can change what lands, which is the same contract
 * the reels work under.
 */
export class HoldStage {
  private readonly root: HTMLDivElement
  private readonly board: HTMLDivElement
  private readonly respinsEl: HTMLDivElement
  private readonly totalEl: HTMLDivElement
  private readonly bannerEl: HTMLDivElement
  private readonly sound: Sound
  private cells: HTMLDivElement[] = []

  constructor(sound: Sound) {
    this.sound = sound

    this.root = document.createElement('div')
    this.root.className = 'hold'
    this.root.hidden = true

    const title = document.createElement('div')
    title.className = 'hold__title'
    title.textContent = 'Hold & spin'

    this.respinsEl = document.createElement('div')
    this.respinsEl.className = 'hold__respins'

    this.board = document.createElement('div')
    this.board.className = 'hold__board'

    this.totalEl = document.createElement('div')
    this.totalEl.className = 'hold__total'

    this.bannerEl = document.createElement('div')
    this.bannerEl.className = 'hold__banner'
    this.bannerEl.hidden = true

    this.root.append(title, this.respinsEl, this.board, this.totalEl, this.bannerEl)
    document.body.append(this.root)
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private build(size: number, columns: number): void {
    this.board.style.setProperty('--hold-columns', String(columns))
    this.cells = []
    const frag = document.createDocumentFragment()
    for (let i = 0; i < size; i++) {
      const cell = document.createElement('div')
      cell.className = 'hold__cell'
      frag.append(cell)
      this.cells.push(cell)
    }
    this.board.replaceChildren(frag)
  }

  private light(index: number, value: number): void {
    const cell = this.cells[index]
    if (!cell) return
    cell.textContent = String(value)
    cell.className = 'hold__cell is-lit'
  }

  /** Replays the whole feature. Resolves once the board has closed. */
  async play(result: HoldResult, columns: number, respins: number): Promise<void> {
    this.build(result.cells.length, columns)
    this.totalEl.textContent = '0'
    this.bannerEl.hidden = true
    this.root.hidden = false
    void this.root.offsetHeight
    this.root.classList.add('is-open')
    this.sound.win('medium')
    await this.wait(OPEN_MS)

    // Everything that landed on the triggering screen locks first.
    const landedLater = new Set(result.rounds.flatMap((r) => r.landed.map((l) => l.cell)))
    let running = 0
    for (let i = 0; i < result.cells.length; i++) {
      const value = result.cells[i]!
      if (value === 0 || landedLater.has(i)) continue
      this.light(i, value)
      running += value
    }
    this.totalEl.textContent = String(running)
    this.respinsEl.textContent = plural(respins)
    this.sound.reelStop(0)
    await this.wait(LOCK_MS)

    for (const round of result.rounds) {
      // Empty cells shiver while the respin runs.
      for (const cell of this.cells) if (!cell.classList.contains('is-lit')) cell.classList.add('is-spinning')
      await this.wait(ROUND_MS * 0.45)
      for (const cell of this.cells) cell.classList.remove('is-spinning')

      for (const { cell, value } of round.landed) {
        this.light(cell, value)
        running += value
        this.totalEl.textContent = String(running)
        this.sound.coinTick(Math.min(1, running / Math.max(1, result.payout)))
      }
      this.respinsEl.textContent = round.respinsLeft === 0 ? 'Last one' : plural(round.respinsLeft)
      await this.wait(ROUND_MS * 0.55)
    }

    if (result.fullBoard) {
      this.bannerEl.hidden = false
      this.bannerEl.textContent = 'Every lantern lit'
      this.sound.win('big')
    }

    this.respinsEl.textContent = ''
    this.totalEl.textContent = String(result.payout)
    this.sound.win(result.payout > 0 ? 'big' : 'small')
    await this.wait(TOTAL_MS)

    this.root.classList.remove('is-open')
    await this.wait(CLOSE_MS)
    this.root.hidden = true
  }
}
