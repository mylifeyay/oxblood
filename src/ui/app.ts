import { tierPay } from '../game/config.ts'
import { SlotMachine, type SpinSnapshot } from '../game/machine.ts'
import { PAYLINE_ROWS } from '../game/paylines.ts'
import { SCATTER, WILD, COIN, L1 } from '../game/symbols.ts'
import { evaluateDetail } from '../game/evaluate.ts'
import { resolveHold } from '../game/hold.ts'
import { Book } from '../game/book.ts'
import { cloneTotals, type Totals } from '../game/ledger.ts'
import { ReelView } from './reelview.ts'
import { Sound } from '../audio/sound.ts'
import { CreditMeter } from './meter.ts'
import { BigWin, Particles, prefersReducedMotion, winTierFor } from './celebrate.ts'
import { openMenu } from './menu.ts'
import { BonusStage } from './bonus.ts'
import { HoldStage } from './holdstage.ts'
import { FreeStage } from './freestage.ts'
import { openAddCredit } from './addcredit.ts'
import { openHelp } from './help.ts'
import { openIntro } from './intro.ts'
import { Stills } from './stills.ts'
import { openLibrary } from './library.ts'
import { openStats } from './stats.ts'
import { DEFAULT_MACHINE, machineById } from '../game/machines.ts'
import { newlyPlayable } from './machines.ts'
import { skinFor } from './skins.ts'
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
  const title = need('marquee-title')
  const subtitle = need('marquee-sub')
  const jackpotPanel = need('jackpot')
  const jackpotValue = need('jackpot-value')
  const tierPayEls = new Map((['mini', 'minor', 'major'] as const).map((name) => [name, need(`tier-pay-${name}`)]))

  const cabinet = need('cabinet')

  // Which cabinet is on. Everything below is built from it: the payout config,
  // the symbols, the palette, the hands and the voice.
  const book = await Book.open()
  const active = machineById(await loadPref('machine', DEFAULT_MACHINE.id))
  const CONFIG = active.config ?? DEFAULT_MACHINE.config!
  const skin = skinFor(active.theme)
  document.documentElement.dataset.machine = active.theme
  title.textContent = active.name
  subtitle.textContent = active.tagline

  const machine = new SlotMachine(CONFIG)
  const view = new ReelView(reelsHost, machine.strips, skin.faces, skin.motion, CONFIG.rows)
  const sound = new Sound(skin.sound)
  const bonus = new BonusStage(Math.random, sound)
  const holdStage = new HoldStage(sound)
  const freeStage = new FreeStage(sound, need('tiers'))

  // Clips the machine has played come back as the face of the wild. Refreshed
  // after every reveal, so a clip won this session is on the reels by the next
  // spin rather than the next launch.
  const stills = new Stills()
  const refreshStills = async (): Promise<void> => {
    if (await stills.refresh()) view.setStills(stills.list)
  }
  void refreshStills()
  const particles = new Particles(frame)
  const bigWin = new BigWin(frame)
  const credits = new CreditMeter(creditMeter, (progress) => sound.coinTick(progress))

  const setReadout = (text: string): void => {
    readout.textContent = text
  }

  sound.setMuted(await loadPref('muted', false))

  // The bet the player last chose, if it is still one we offer.
  const savedBet = await loadPref('betPerLine', CONFIG.betPerLine)
  machine.betPerLine = CONFIG.betLevels.includes(savedBet) ? savedBet : CONFIG.betPerLine

  // The pot survives closing the app. It is per machine, and it only ever
  // restarts when somebody wins it.
  const potKey = `jackpot:${active.id}`
  if (CONFIG.progressive) {
    machine.restoreJackpot(await loadPref(potKey, machine.seedJackpot))
    jackpotPanel.hidden = false
  }
  const renderJackpot = (): void => {
    if (!CONFIG.progressive) return
    jackpotValue.textContent = String(Math.round(machine.jackpot))
  }


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
    renderJackpot()
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

  /** Everything win highlighting needs. A free spin has no tier of its own. */
  type Screen = Pick<SpinSnapshot, 'grid' | 'lineWins'> & { tier?: SpinSnapshot['tier'] }

  const showWins = (snap: Screen): void => {
    clearWins()
    const seen = new Set<number>()
    const rows = CONFIG.rows
    const reelCount = CONFIG.reels.length
    const mark = (reel: number, row: number, scatter: boolean): void => {
      const key = reel * rows + row
      if (seen.has(key)) return
      seen.add(key)
      markWin(reel, row, scatter)
    }

    for (const win of snap.lineWins) {
      if (CONFIG.evaluation === 'ways') {
        // A ways win has no line to trace: every place the symbol landed on the
        // contributing reels is part of it.
        for (let reel = 0; reel < win.count; reel++) {
          for (let row = 0; row < rows; row++) {
            const cell = snap.grid[reel * rows + row]
            if (cell === win.symbol || cell === WILD) mark(reel, row, false)
          }
        }
        continue
      }
      const lineRows = PAYLINE_ROWS[win.line]!
      for (let reel = 0; reel < win.count; reel++) mark(reel, lineRows[reel]!, false)
    }

    if (snap.tier) {
      for (let reel = 0; reel < reelCount; reel++) {
        for (let row = 0; row < rows; row++) {
          if (snap.grid[reel * rows + row] === SCATTER) mark(reel, row, true)
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
    // A ways machine has no lines to count; it pays per symbol.
    const noun = CONFIG.evaluation === 'ways' ? 'symbol' : 'line'
    const lines = snap.lineWins.length
    if (lines === 1) parts.push(`1 ${noun}`)
    else if (lines > 1) {
      parts.push(`${lines} ${noun}s`)
      plural = true
    }

    // A spin that bought a round is described by what the round paid, not by
    // the screen that bought it — that screen is usually worth nothing itself.
    if (snap.free) {
      const round = `${snap.free.played} free spins`
      if (parts.length === 0) return snap.freePayout > 0 ? `${round} pay ${snap.freePayout}` : `${round} pay nothing`
      parts.push(round)
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

  const resolve = async (snap: SpinSnapshot, before: Totals): Promise<void> => {
    lastResult = snap
    const at = Date.now()

    // Line and bonus are recorded separately so the stats screen can say where
    // the money actually came from.
    if (snap.linePayout > 0) book.append({ t: 'win', amount: snap.linePayout, at, kind: 'line' })
    if (snap.tier && snap.bonusPayout > 0) book.append({ t: 'win', amount: snap.bonusPayout, at, kind: snap.tier.name })
    // The pot counts as a Major win in the books; it only ever lands with one.
    if (snap.jackpotPayout > 0) book.append({ t: 'win', amount: snap.jackpotPayout, at, kind: 'major' })
    // The lanterns are their own thing, but in the books they are a line win —
    // they come off the reels, not out of a tier.
    if (snap.holdPayout > 0) book.append({ t: 'win', amount: snap.holdPayout, at, kind: 'line' })
    // Free spins pay off the reels, so they book as reel wins too.
    if (snap.freePayout > 0) book.append({ t: 'win', amount: snap.freePayout, at, kind: 'line' })
    if (CONFIG.progressive) void saveSetting(potKey, machine.jackpot)

    showWins(snap)
    setReadout(describe(snap))
    announceUnlocks(before)

    revealing = true
    refreshButtons()
    try {
      // A bonus has its own reveal; the line win is celebrated on its own only
      // when there is no clip taking over the screen.
      // Hold and spin is triggered by the base screen, so it goes before the
      // clip reveal when a spin somehow sets off both.
      if (snap.hold) {
        await holdStage.play(snap.hold, CONFIG.reels.length, CONFIG.hold?.respins ?? 3)
        // The meter waits if a clip or the pot is still to come — those roll
        // their own totals in, and there is no sense spoiling them here.
        const bigger = snap.tier !== null || snap.jackpotPayout > 0
        if (!bigger) await credits.rollTo(book.balance, rollDuration(snap.totalPayout))
      }

      if (snap.jackpotPayout > 0) {
        // The pot goes first: it is the largest thing that can happen here.
        shake()
        burstFromWins()
        const climb = Math.min(9000, 2600 + Math.sqrt(snap.jackpotPayout) * 90)
        await Promise.all([
          bigWin.show(snap.jackpotPayout, climb, (p) => sound.coinTick(p), 'Jackpot'),
          credits.rollTo(book.balance, climb),
        ])
        await new Promise((r) => setTimeout(r, 900))
        await bigWin.hide()
        if (snap.tier) await bonus.reveal(snap.tier.name, snap.bonusPayout)
      } else if (snap.tier) {
        await bonus.reveal(snap.tier.name, snap.bonusPayout)
        await credits.rollTo(book.balance, rollDuration(snap.totalPayout))
      } else if (snap.totalPayout > 0 && !snap.hold && !snap.free) {
        await celebrate(snap.totalPayout)
      } else if (!snap.free) {
        credits.set(book.balance)
      }

      // The round goes last: it borrows the reels, and everything before it
      // wants the screen that actually triggered it still on the glass.
      if (snap.free) {
        await playFreeRound(snap.free)
        view.settleAt(snap.stops)
        showWins(snap)
        setReadout(describe(snap))
        await credits.rollTo(book.balance, rollDuration(snap.totalPayout))
      }
      if (snap.tier) await refreshStills()
    } finally {
      revealing = false
    }

    refreshButtons()
    if (book.balance < machine.totalBet) setReadout(shortfallMessage())
  }

  /** A cabinet earned mid-session should say so, once. */
  const announceUnlocks = (before: Totals): void => {
    for (const earned of newlyPlayable(before, book.lifetime)) {
      const toast = document.createElement('div')
      toast.className = 'toast'
      toast.style.setProperty('--accent', earned.accent)
      toast.innerHTML = ''
      const label = document.createElement('span')
      label.className = 'toast__label'
      label.textContent = 'New machine'
      const name = document.createElement('span')
      name.className = 'toast__name'
      name.textContent = earned.name
      toast.append(label, name)
      cabinet.append(toast)
      sound.win('big')
      window.setTimeout(() => toast.classList.add('is-out'), 4200)
      window.setTimeout(() => toast.remove(), 4800)
    }
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

  /**
   * The reel animation as a promise, so a free round can await each spin.
   *
   * `spinTo` drops its callback if the reels are already turning — the guard
   * that makes a double tap harmless. Nothing can start a spin mid-round, but a
   * promise that could never settle would hang the round rather than glitch it,
   * so the impossible case resolves instead of waiting forever.
   */
  const spinReels = (stops: readonly number[]): Promise<void> =>
    new Promise((done) => {
      if (view.busy) {
        done()
        return
      }
      view.spinTo(stops, done)
    })

  /**
   * Plays a free spin round out on the real cabinet.
   *
   * Everything has already been decided — this walks the spins the engine
   * handed over, turning the reels to each one in turn. The multiplier only
   * ratchets after a paying spin, which is the beat the whole feature is built
   * around, so it gets its own moment before the next spin starts.
   */
  const playFreeRound = async (free: NonNullable<SpinSnapshot['free']>): Promise<void> => {
    const cfg = CONFIG.free!
    await freeStage.intro(cfg.spins)

    let running = 0
    let multiplier = 1
    for (const fs of free.spins) {
      freeStage.update(fs.spinsLeft + 1, fs.multiplier, running)
      clearWins()
      setReadout(`Free spin${fs.multiplier > 1 ? ` at ${fs.multiplier}x` : ''}`)
      await spinReels(fs.stops)

      const { wins } = evaluateDetail(fs.grid, CONFIG, machine.betPerLine)
      showWins({ grid: fs.grid, lineWins: wins })

      running += fs.pay
      freeStage.update(fs.spinsLeft, multiplier, running)
      if (fs.pay > 0) {
        setReadout(fs.multiplier > 1 ? `${fs.basePay} at ${fs.multiplier}x pays ${fs.pay}` : `Pays ${fs.pay}`)
        const tier = winTierFor(fs.pay, machine.totalBet)
        sound.win(tier === 'none' ? 'small' : tier)
        await new Promise((r) => setTimeout(r, 520))
      } else {
        setReadout('No win')
        await new Promise((r) => setTimeout(r, 240))
      }

      if (fs.added > 0) await freeStage.award(fs.added)
      if (fs.basePay > 0 && multiplier < cfg.multiplierCap) {
        multiplier++
        freeStage.ratchet(multiplier)
        await new Promise((r) => setTimeout(r, 340))
      }
    }

    clearWins()
    await freeStage.outro(free.total, free.played, free.finalMultiplier)
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

    // Snapshot before the wager lands, or a machine earned by this very spin
    // would already look earned by the time the crossing is checked.
    const before = cloneTotals(book.lifetime)
    book.append({ t: 'wager', amount: machine.totalBet, at: Date.now() })
    lastResult = null
    credits.set(book.balance)
    renderJackpot()
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

    view.spinTo(snap.stops, () => void resolve(snap, before))
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
  menuButton.addEventListener('click', () => openMenu(book, sound, active.id, () => void refreshStills()))

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
    openStats(book, { ...CONFIG, betPerLine: machine.betPerLine }, () => {
      renderMeters()
      refreshButtons()
      setReadout('Statistics reset')
    })
  })
  betButton.addEventListener('click', cycleBet)
  helpButton.addEventListener('click', () => openHelp({ ...CONFIG, betPerLine: machine.betPerLine }, skin.faces))

  renderMeters()
  refreshButtons()
  setReadout(book.balance < machine.totalBet ? shortfallMessage() : 'Spin to play')

  // First run only. The flag is written when the tour ends rather than when it
  // starts, so closing the app halfway through means it is still owed.
  if (!(await loadPref('introSeen', false))) {
    openIntro(sound, () => openLibrary())
    void saveSetting('introSeen', true)
  }

  // A Major lands once in eight hundred spins, which is no way to check that
  // its longer wipe and held beat look right. Stripped from production builds.
  if (import.meta.env.DEV) {
    const hooks = window as unknown as Record<string, unknown>
    hooks.__stage = bonus
    // A big line win needs twenty times the bet and is far too rare to wait for.
    hooks.__celebrate = (payout: number) => celebrate(payout)
    // Hold and spin fires once in two hundred and fifty spins.
    // A round lands once in a hundred and thirty spins. Rolling until the reels
    // buy one keeps the replay a real round rather than a staged one.
    hooks.__free = () => {
      if (!CONFIG.free) return null
      for (let i = 0; i < 20000; i++) {
        machine.next()
        if (machine.free) return playFreeRound(machine.free)
      }
      return null
    }
    hooks.__hold = (coins = CONFIG.hold?.triggerCount ?? 6) => {
      const cells = new Int8Array(CONFIG.reels.length * CONFIG.rows).fill(L1)
      for (let i = 0; i < coins; i++) cells[i] = COIN
      const result = resolveHold(CONFIG, machine.totalBet, cells, Math.random)
      return result && holdStage.play(result, CONFIG.reels.length, CONFIG.hold?.respins ?? 3)
    }
  }
}
