import { CONFIG, tierPay } from '../game/config.ts'
import { SlotMachine, type SpinSnapshot } from '../game/machine.ts'
import { PAYLINE_ROWS, REELS, ROWS } from '../game/paylines.ts'
import { SCATTER } from '../game/symbols.ts'
import { Book } from '../game/book.ts'
import { ReelView } from './reelview.ts'
import { Sound } from '../audio/sound.ts'
import { CreditMeter } from './meter.ts'
import { BigWin, Particles, prefersReducedMotion, winTierFor } from './celebrate.ts'
import { openMenu } from './menu.ts'
import { BonusStage } from './bonus.ts'
import { openAddCredit } from './addcredit.ts'
import { openHelp } from './help.ts'
import { openStats } from './stats.ts'
import { DEFAULT_MACHINE, machineById } from '../game/machines.ts'
import { saveSetting, loadSetting as loadPref } from '../game/settings.ts'

function need<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing element #${id}`)
  return el as T
}

export async function startGame(): Promise<void> {
  const frame = need('screen-frame')
  const reelsHost = need('reels')
  const winLayer = need('wins')
  const readout = need('readout')
  const creditMeter = need('credit-meter')
  const betMeter = need('bet-meter')
  const spinButton = need<HTMLButtonElement>('spin')
  const addButton = need<HTMLButtonElement>('add-credit')
  const menuButton = need<HTMLButtonElement>('menu')
  const betButton = need<HTMLButtonElement>('bet')
  const helpButton = need<HTMLButtonElement>('help')
  const tierPayEls = new Map(CONFIG.tiers.map((tier) => [tier.name, need(`tier-pay-${tier.name}`)]))
  const title = need('marquee-title')

  const cabinet = need('cabinet')
  const machine = new SlotMachine(CONFIG)
  const view = new ReelView(reelsHost, machine.strips)
  const sound = new Sound()
  const bonus = new BonusStage(Math.random, sound)
  const particles = new Particles(frame)
  const bigWin = new BigWin(frame)
  const credits = new CreditMeter(creditMeter, (progress) => sound.coinTick(progress))

  const setReadout = (text: string): void => {
    readout.textContent = text
  }

  setReadout('Opening the ledger')
  const book = await Book.open()
  sound.setMuted(await loadPref('muted', false))

  // The bet the player last chose, if it is still one we offer.
  const savedBet = await loadPref('betPerLine', CONFIG.betPerLine)
  machine.betPerLine = CONFIG.betLevels.includes(savedBet) ? savedBet : CONFIG.betPerLine

  // Only one cabinet is built, but the active one is already a stored choice
  // so a second machine is a data change rather than a rewrite.
  const activeMachine = machineById(await loadPref('machine', DEFAULT_MACHINE.id))

  // The clack as each reel lands, and the riser while one hangs on.
  const risers = new Map<number, { stop(): void }>()
  view.onReelStop = (index) => sound.reelStop(index)
  view.onAnticipation = (index, active) => {
    if (active) {
      risers.set(index, sound.startRiser(1.4))
    } else {
      risers.get(index)?.stop()
      risers.delete(index)
    }
  }

  // Put the pity timer and cooldown back where the last session left them, so
  // the drought guarantee holds across a reload rather than only within one.
  machine.restore(book.lifetime.sinceMini, book.lifetime.sinceBonus)

  let lastResult: SpinSnapshot | null = null
  // The reels finish before the reveal does, so `view.busy` alone would unlock
  // the controls halfway through a bonus.
  let revealing = false

  const renderMeters = (): void => {
    credits.set(book.balance)
    renderBet()
  }

  /** The bet meter and the tier signage above the reels move together. */
  const renderBet = (): void => {
    betMeter.textContent = String(machine.totalBet)
    for (const tier of CONFIG.tiers) {
      const el = tierPayEls.get(tier.name)
      if (el) el.textContent = String(tierPay(tier, machine.totalBet))
    }
  }

  const clearWins = (): void => {
    winLayer.replaceChildren()
  }

  const markWin = (reel: number, row: number, scatter: boolean): void => {
    const box = view.cellBox(reel, row)
    const el = document.createElement('div')
    el.className = scatter ? 'win-cell win-cell--scatter' : 'win-cell'
    el.style.left = `${box.x}px`
    el.style.top = `${box.y}px`
    el.style.width = `${box.w}px`
    el.style.height = `${box.h}px`
    winLayer.append(el)
  }

  const showWins = (snap: SpinSnapshot): void => {
    clearWins()
    const seen = new Set<number>()

    for (const win of snap.lineWins) {
      const rows = PAYLINE_ROWS[win.line]!
      for (let reel = 0; reel < win.count; reel++) {
        const row = rows[reel]!
        const key = reel * ROWS + row
        if (seen.has(key)) continue
        seen.add(key)
        markWin(reel, row, false)
      }
    }

    if (snap.tier) {
      for (let reel = 0; reel < REELS; reel++) {
        for (let row = 0; row < ROWS; row++) {
          if (snap.grid[reel * ROWS + row] !== SCATTER) continue
          const key = reel * ROWS + row
          if (seen.has(key)) continue
          seen.add(key)
          markWin(reel, row, true)
        }
      }
    }
  }

  const describe = (snap: SpinSnapshot): string => {
    const parts: string[] = []
    let plural = false

    if (snap.tier) {
      const name = snap.tier.name
      parts.push(`${name.charAt(0).toUpperCase()}${name.slice(1)} bonus`)
    }
    const lines = snap.lineWins.length
    if (lines === 1) parts.push('1 line')
    else if (lines > 1) {
      parts.push(`${lines} lines`)
      plural = true
    }

    if (parts.length === 0) return 'No win'
    if (parts.length > 1) plural = true
    return `${parts.join(' and ')} ${plural ? 'pay' : 'pays'} ${snap.totalPayout}`
  }

  const refreshButtons = (): void => {
    const locked = view.busy || revealing
    const broke = book.balance < machine.totalBet
    spinButton.disabled = locked || broke
    addButton.disabled = locked
    menuButton.disabled = locked
    betButton.disabled = locked
    helpButton.disabled = locked
  }

  const resolve = async (snap: SpinSnapshot): Promise<void> => {
    lastResult = snap
    const at = Date.now()

    // Line and bonus are recorded separately so the stats screen can say where
    // the money actually came from.
    if (snap.linePayout > 0) book.append({ t: 'win', amount: snap.linePayout, at, kind: 'line' })
    if (snap.tier && snap.bonusPayout > 0) book.append({ t: 'win', amount: snap.bonusPayout, at, kind: snap.tier.name })

    showWins(snap)
    setReadout(describe(snap))

    revealing = true
    refreshButtons()
    try {
      // A bonus has its own reveal; the line win is celebrated on its own only
      // when there is no clip taking over the screen.
      if (snap.tier) {
        await bonus.reveal(snap.tier.name, snap.bonusPayout)
        await credits.rollTo(book.balance, rollDuration(snap.totalPayout))
      } else if (snap.totalPayout > 0) {
        await celebrate(snap.totalPayout)
      } else {
        credits.set(book.balance)
      }
    } finally {
      revealing = false
    }

    refreshButtons()
    if (book.balance < machine.totalBet) setReadout(shortfallMessage())
  }

  /** Out of credit for this bet, which a smaller bet might still cover. */
  const shortfallMessage = (): string =>
    machine.betPerLine > CONFIG.betLevels[0]!
      ? 'Not enough credit for this bet. Lower it, or add credit.'
      : 'Out of credit. Tap add credit.'

  const cycleBet = (): void => {
    if (view.busy || revealing) return
    const levels = CONFIG.betLevels
    const next = levels[(levels.indexOf(machine.betPerLine) + 1) % levels.length] ?? CONFIG.betPerLine
    machine.betPerLine = next
    void saveSetting('betPerLine', next)
    renderBet()
    refreshButtons()
    setReadout(
      book.balance < machine.totalBet
        ? shortfallMessage()
        : `Betting ${machine.totalBet} — ${next} on each of ${CONFIG.lineCount} lines`,
    )
    sound.reelStop(2)
  }

  /** Longer wins take longer to count, but never absurdly so. */
  const rollDuration = (payout: number): number =>
    Math.min(4200, 420 + Math.sqrt(Math.max(0, payout)) * 130)

  /** Bursts from the middle of every highlighted cell. */
  const burstFromWins = (): void => {
    if (prefersReducedMotion()) return
    for (const el of winLayer.children) {
      const box = el as HTMLElement
      particles.burst(box.offsetLeft + box.offsetWidth / 2, box.offsetTop + box.offsetHeight / 2, 12)
    }
  }

  // Cleared on animationend rather than a timer: a timer throttled in the
  // background leaves the class on, and every later spin inherits the shake.
  cabinet.addEventListener('animationend', (event) => {
    if (event.animationName === 'shake') cabinet.classList.remove('is-shaking')
  })

  const shake = (): void => {
    if (prefersReducedMotion()) return
    cabinet.classList.remove('is-shaking')
    void cabinet.offsetWidth
    cabinet.classList.add('is-shaking')
  }

  const celebrate = async (payout: number): Promise<void> => {
    const tier = winTierFor(payout, machine.totalBet)
    sound.win(tier === 'none' ? 'small' : tier)

    if (tier === 'medium') {
      shake()
      burstFromWins()
    }

    if (tier === 'big') {
      shake()
      burstFromWins()
      // Everything else stops. The panel holds while the amount climbs.
      const climb = Math.min(6000, 1800 + Math.sqrt(payout) * 120)
      await Promise.all([
        bigWin.show(payout, climb, (progress) => sound.coinTick(progress)),
        credits.rollTo(book.balance, climb),
      ])
      await new Promise((resolve) => setTimeout(resolve, 700))
      await bigWin.hide()
      return
    }

    await credits.rollTo(book.balance, rollDuration(payout))
  }

  const spin = (): void => {
    if (view.busy || book.balance < machine.totalBet) return

    // Both must happen inside the tap: iOS grants audio permission only during
    // a gesture, and the bonus reveal is seconds too late to count.
    sound.unlock()
    bonus.prime()

    book.append({ t: 'wager', amount: machine.totalBet, at: Date.now() })
    lastResult = null
    credits.set(book.balance)
    particles.clear()
    clearWins()
    setReadout('Good luck')
    refreshButtons()

    // The outcome is settled here, before a single frame is drawn.
    machine.next()
    const snap = machine.snapshot()

    // The outcome is already known, so the exact clip can be loaded and seeked
    // while the reels are still turning. By the time the last one stops the
    // seek has resolved and the reveal is instant.
    if (snap.tier) void bonus.prefetch(snap.tier.name)

    view.spinTo(snap.stops, () => void resolve(snap))
  }

  const addCredit = (): void => {
    openAddCredit((amount) => {
      book.append({ t: 'credit', amount, at: Date.now() })
      renderMeters()
      refreshButtons()
      setReadout(`Added ${amount.toLocaleString('en-GB')} credit`)
    })
  }

  // The reel window is sized against the viewport, so cell height has to be
  // re-read whenever the layout settles or the device rotates. Any win on
  // screen is redrawn at the new geometry rather than thrown away.
  const relayout = (): void => {
    view.measure()
    particles.resize()
    if (lastResult && !view.busy) showWins(lastResult)
  }

  // ResizeObserver is the precise signal, but its callbacks are delivered with
  // the rendering steps, which Safari suspends while the app is backgrounded.
  // The window events cover the rotation case on the way back.
  new ResizeObserver(relayout).observe(frame)
  window.addEventListener('resize', relayout)
  window.addEventListener('orientationchange', relayout)

  spinButton.addEventListener('click', spin)
  addButton.addEventListener('click', addCredit)
  menuButton.addEventListener('click', () => openMenu(book, sound, activeMachine.id))

  // Stats are not on the menu. Three taps on the marquee opens them.
  let titleTaps = 0
  let tapTimer: number | undefined
  title.addEventListener('click', () => {
    titleTaps++
    window.clearTimeout(tapTimer)
    tapTimer = window.setTimeout(() => {
      titleTaps = 0
    }, 900)
    if (titleTaps < 3) return
    titleTaps = 0
    window.clearTimeout(tapTimer)
    sound.unlock()
    sound.reelStop(1)
    openStats(book, () => {
      renderMeters()
      refreshButtons()
      setReadout('Statistics reset')
    })
  })
  betButton.addEventListener('click', cycleBet)
  helpButton.addEventListener('click', () => openHelp(machine.betPerLine))

  renderMeters()
  refreshButtons()
  setReadout(book.balance < machine.totalBet ? shortfallMessage() : 'Spin to play')

  // A Major lands once in eight hundred spins, which is no way to check that
  // its longer wipe and held beat look right. Stripped from production builds.
  if (import.meta.env.DEV) {
    const hooks = window as unknown as Record<string, unknown>
    hooks.__stage = bonus
    // A big line win needs twenty times the bet and is far too rare to wait for.
    hooks.__celebrate = (payout: number) => celebrate(payout)
  }
}
