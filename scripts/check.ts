/**
 * Assertions over the payout engine. The Monte Carlo tells you the aggregate
 * is plausible; these tell you the rules are actually the rules.
 */
import { CONFIG } from '../src/game/config.ts'
import { JADE_CONFIG } from '../src/game/jade.ts'
import { resolveHold, pickValue } from '../src/game/hold.ts'
import { EMBER_CONFIG } from '../src/game/ember.ts'
import { GILT_CONFIG } from '../src/game/gilt.ts'
import { resolveFree, countFrees } from '../src/game/free.ts'
import { MACHINES, isEarned } from '../src/game/machines.ts'
import { emptyTotals } from '../src/game/ledger.ts'
import { evaluateWaysTotal } from '../src/game/evaluate.ts'
import { SlotMachine } from '../src/game/machine.ts'
import { L1, L2, L3, L4, M1, M2, WILD, SCATTER, COIN, FREE, SYMBOL_COUNT } from '../src/game/symbols.ts'
import { evaluateLines, countScatters } from '../src/game/evaluate.ts'
import { buildStrips, dealStills } from '../src/game/reels.ts'
import { reelScatterDistribution } from '../src/game/analysis.ts'
import { ROWS, REELS } from '../src/game/paylines.ts'
import { poolFor, pickVideo, pickSlice, describeSlice, CLIP_SECONDS } from '../src/game/bonus.ts'
import { mulberry32 } from '../src/game/random.ts'
import { coveredSegments, isFullyUnlocked, segmentCount, unlockedRuns, type Tier, type VideoMeta } from '../src/game/videos.ts'

let failures = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `\n          expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

/** Builds a grid from a middle-row run, filling the other rows with blanks. */
function grid(middle: number[], filler = L4): Int8Array {
  const g = new Int8Array(REELS * ROWS)
  for (let reel = 0; reel < REELS; reel++) {
    // Rows 0 and 2 get a symbol that cannot extend the middle-row run.
    g[reel * ROWS + 0] = filler
    g[reel * ROWS + 1] = middle[reel]!
    g[reel * ROWS + 2] = filler
  }
  return g
}

const pay = (middle: number[], filler?: number): number => {
  const { wins } = evaluateLines(grid(middle, filler), CONFIG, CONFIG.betPerLine)
  const line = wins.find((w) => w.line === 0) // payline 0 is the middle row
  return line ? line.pay : 0
}

// Expected values come from the config, not from literals, so tuning the
// paytable cannot break these tests. What is under test is the rule.
const PAY = (symbol: number, count: number): number => CONFIG.paytable[symbol]![count - 3]!

console.log('\nLine evaluation\n')

check('five L1 pays the 5-of-a-kind value', pay([L1, L1, L1, L1, L1], M2), PAY(L1, 5))
check('four L1 then a miss pays the 4 value', pay([L1, L1, L1, L1, M1], M2), PAY(L1, 4))
check('three L1 then a miss pays the 3 value', pay([L1, L1, L1, M1, M1], M2), PAY(L1, 3))
check('two L1 pays nothing', pay([L1, L1, M1, M1, M1], M2), 0)
check('WILD substitutes mid-run', pay([L1, L1, WILD, L1, L1], M2), PAY(L1, 5))
check('WILD substitutes at the end', pay([M1, M1, M1, M1, WILD], M2), PAY(M1, 5))
check('five WILDs pay the WILD value, not the low one', pay([WILD, WILD, WILD, WILD, WILD], M2), PAY(WILD, 5))
check('SCATTER breaks a run', pay([L1, L1, SCATTER, L1, L1], M2), 0)
check('SCATTER on reel 1 pays no line', pay([SCATTER, L1, L1, L1, L1], M2), 0)
check('a run must start on reel 1', pay([M1, L1, L1, L1, L1], M2), 0)

// The "best of two readings" rule: three leading WILDs can either pay as three
// WILDs (15) or lead a longer run of something else. The larger must win.
check('three WILDs leading a five-run of M1 beats three WILDs', pay([WILD, WILD, WILD, M1, M1], M2), Math.max(PAY(M1, 5), PAY(WILD, 3)))
check('three WILDs leading a four-run of L4 beats the L4 four', pay([WILD, WILD, WILD, L4, M1], M2), Math.max(PAY(L4, 4), PAY(WILD, 3)))
// Four WILDs followed by M1 is a five-of-a-kind M1, because WILD substitutes.
// It is not "four wilds and a miss" — that reading only applies when the fifth
// symbol cannot be substituted for, i.e. when it is a SCATTER.
check('four WILDs then M1 is five M1, not four WILDs', pay([WILD, WILD, WILD, WILD, M1], M2), Math.max(PAY(M1, 5), PAY(WILD, 4)))
check('four WILDs then a SCATTER pays the WILD four', pay([WILD, WILD, WILD, WILD, SCATTER], M2), PAY(WILD, 4))
check('a leading WILD extends a low run to five', pay([WILD, L1, L1, L1, L1], M2), PAY(L1, 5))

// Guard: the "best of two readings" tests only prove anything while the two
// readings actually disagree. If tuning ever makes them equal, say so loudly.
if (PAY(M1, 5) === PAY(WILD, 3) || PAY(L4, 4) === PAY(WILD, 3)) {
  failures++
  console.log('  FAIL  paytable tuning has made the two readings equal; these tests no longer prove the rule')
}

console.log('\nScatters pay anywhere, not on lines\n')

// Alternating reels so that no payline can form a run of three, which isolates
// the scatter behaviour from any line win.
const anywhere = new Int8Array(REELS * ROWS)
for (let reel = 0; reel < REELS; reel++) {
  for (let row = 0; row < ROWS; row++) anywhere[reel * ROWS + row] = reel % 2 === 0 ? L1 : M1
}
check('the barren grid really does pay nothing', evaluateLines(anywhere, CONFIG, CONFIG.betPerLine).wins.length, 0)

anywhere[0 * ROWS + 0] = SCATTER // top of reel 1
anywhere[2 * ROWS + 2] = SCATTER // bottom of reel 3
anywhere[4 * ROWS + 1] = SCATTER // middle of reel 5
check('three scatters on three different rows still count', countScatters(anywhere), 3)
check('scatters pay no line of their own', evaluateLines(anywhere, CONFIG, CONFIG.betPerLine).wins.length, 0)

console.log('\nStrip construction\n')

const strips = buildStrips(CONFIG)
strips.forEach((strip, reel) => {
  const counted = [0, 0, 0]
  for (let stop = 0; stop < strip.length; stop++) {
    let scatters = 0
    for (let row = 0; row < ROWS; row++) if (strip.wrapped[stop + row] === SCATTER) scatters++
    if (scatters > 2) {
      failures++
      console.log(`  FAIL  reel ${reel + 1} can show ${scatters} scatters at stop ${stop}`)
    }
    counted[Math.min(scatters, 2)]!++
  }

  const empirical = counted.map((c) => c / strip.length)
  const closedForm = reelScatterDistribution(CONFIG, reel)
  const same = empirical.every((v, i) => Math.abs(v - closedForm[i]!) < 1e-12)
  if (!same) failures++
  console.log(
    `  ${same ? 'pass' : 'FAIL'}  reel ${reel + 1} window counts match the closed form ` +
      `(none ${empirical[0]!.toFixed(3)}, one ${empirical[1]!.toFixed(3)}, two ${empirical[2]!.toFixed(3)})`,
  )

  const total = CONFIG.reels[reel]!.weights.reduce((a, b) => a + b, 0)
  check(`reel ${reel + 1} strip length matches its weights`, strip.length, total)

  const tally = new Array<number>(SYMBOL_COUNT).fill(0)
  for (const symbol of strip.symbols) tally[symbol]!++
  check(`reel ${reel + 1} symbol counts match its weights`, tally, [...CONFIG.reels[reel]!.weights])
})

console.log('\nWays scoring (Jade Parlour)\n')

{
  const bet = JADE_CONFIG.betPerLine
  const jadePay = (symbol: number, count: number): number => JADE_CONFIG.paytable[symbol]![count - 3]!

  /** Builds a grid column by column, each column a list of three symbols. */
  const columns = (cols: number[][]): Int8Array => {
    const g = new Int8Array(REELS * ROWS)
    for (let reel = 0; reel < REELS; reel++)
      for (let row = 0; row < ROWS; row++) g[reel * ROWS + row] = cols[reel]![row]!
    return g
  }
  const only = (s: number): number[] => [s, s, s]
  const none = (s: number): number[] => [s, s, s]

  const total = (g: Int8Array): number => evaluateWaysTotal(g, JADE_CONFIG, bet)

  // Three reels of three L1, then a reel with none: 3 x 3 x 3 = 27 ways.
  check(
    'three full reels of one symbol is 27 ways',
    total(columns([only(L1), only(L1), only(L1), none(M2), none(M2)])),
    jadePay(L1, 3) * 27 * bet,
  )

  // One place on each of three reels is a single way. Filler is chosen so no
  // other symbol also spans three reels from the first — in a ways machine
  // everything on screen is scored, so a careless grid pays twice.
  check(
    'one place on each of three reels is 1 way',
    total(columns([[L1, L2, L3], [L1, L4, M1], [L1, L4, M1], only(M2), only(M2)])),
    jadePay(L1, 3) * 1 * bet,
  )

  // A wild column counts for the symbol it stands in for.
  check(
    'a full wild reel multiplies the ways',
    total(columns([[L1, M1, M1], only(WILD), [L1, M1, M1], none(M2), none(M2)])),
    jadePay(L1, 3) * (1 * 3 * 1) * bet + jadePay(M1, 3) * (2 * 3 * 2) * bet,
  )

  // Two reels is never a win, however many places it lands on.
  check('two reels pays nothing', total(columns([only(L1), only(L1), none(M2), none(M2), none(M2)])), 0)

  // Wild pays nothing of its own in a ways machine.
  check('a screen of wilds does not pay as wild', JADE_CONFIG.paytable[WILD]!.every((p) => p === 0), true)

  check('the scatter never pays a way', total(columns([only(SCATTER), only(SCATTER), only(SCATTER), none(M2), none(M2)])), 0)
}

console.log('\nEmber Room: six reels and a pot\n')

{
  check('the board is six by four', [EMBER_CONFIG.reels.length, EMBER_CONFIG.rows], [6, 4])
  check('the paytable reaches six of a kind', EMBER_CONFIG.paytable[M2]!.length, 4)

  // Six full reels of one symbol: 4^6 = 4096 ways, the whole board.
  const grid = new Int8Array(6 * 4).fill(M2)
  check(
    'a full board of one symbol is 4096 ways',
    evaluateWaysTotal(grid, EMBER_CONFIG, EMBER_CONFIG.betPerLine),
    EMBER_CONFIG.paytable[M2]![3]! * 4096 * EMBER_CONFIG.betPerLine,
  )

  const machine = new SlotMachine(EMBER_CONFIG, 5)
  const contribution = EMBER_CONFIG.progressive!.contribution * machine.totalBet
  check('the pot starts at its seed', machine.jackpot, machine.seedJackpot)

  // Every wager feeds it, and it is handed over whole when six scatters land.
  let paidOut = 0
  let hits = 0
  let previous = machine.jackpot
  let growthWrong = 0
  const spins = 400_000
  for (let i = 0; i < spins; i++) {
    machine.next()
    if (machine.jackpotPayout > 0) {
      paidOut += machine.jackpotPayout
      hits++
      if (machine.jackpot !== machine.seedJackpot) growthWrong++
    } else if (Math.abs(machine.jackpot - (previous + contribution)) > 1e-6) {
      growthWrong++
    }
    previous = machine.jackpot
  }
  check('the pot grows by its contribution on every spin and reseeds when won', growthWrong, 0)

  // Contributions in must come back out, give or take the seed it restarts from.
  const wagered = spins * machine.totalBet
  const takenIn = wagered * EMBER_CONFIG.progressive!.contribution
  const seedGiven = hits * machine.seedJackpot
  const drift = Math.abs(paidOut - (takenIn + seedGiven)) / wagered
  const selfFunding = drift < 0.01
  if (!selfFunding) failures++
  console.log(
    `  ${selfFunding ? 'pass' : 'FAIL'}  the pot pays back what it takes plus its seed ` +
      `(in ${(100 * takenIn / wagered).toFixed(2)}% + seeds ${(100 * seedGiven / wagered).toFixed(2)}%, out ${(100 * paidOut / wagered).toFixed(2)}%)`,
  )
}

console.log('\nSegment unlocking\n')

{
  const meta = (duration: number, segments: number[]): VideoMeta =>
    ({ id: 'x', name: 'x', tier: 'common', timesPlayed: 1, duration, importedAt: 0, bytes: 0, fingerprint: 'x',
       width: 1, height: 1, unlockedSegments: segments, poster: null as unknown as Blob })

  check('a 90s video is 9 segments', segmentCount(90), 9)
  check('a 95s video is 10 segments', segmentCount(95), 10)
  check('a Mini at 0 reveals one segment', coveredSegments(0, 10, 90), [0])
  check('a Mini straddling a boundary reveals two', coveredSegments(12.5, 10, 90), [1, 2])
  check('a Minor reveals the two it crosses', coveredSegments(20, 15, 90), [2, 3])
  check('a Major reveals four', coveredSegments(5, 30, 90), [0, 1, 2, 3])
  check('a slice cannot reveal past the end', coveredSegments(85, 30, 90), [8])
  check('adjacent segments merge into one run', unlockedRuns(meta(90, [0, 1, 2, 5, 6])), [
    { start: 0, end: 30 },
    { start: 50, end: 70 },
  ])
  check('the last run stops at the duration', unlockedRuns(meta(25, [2])), [{ start: 20, end: 25 }])
  check('a video is complete only when every segment is in', isFullyUnlocked(meta(30, [0, 1])), false)
  check('all segments means complete', isFullyUnlocked(meta(30, [0, 1, 2])), true)

  // Clips won before segments existed keep the access they already had.
  const legacy: VideoMeta = { ...meta(90, []), timesPlayed: 3 }
  delete (legacy as { unlockedSegments?: number[] }).unlockedSegments
  check('a clip won before segment tracking stays fully unlocked', isFullyUnlocked(legacy), true)
}

console.log('\nBet levels\n')

// Bonus tiers pay a multiple of the total bet, so return must not depend on
// what you are betting. If this ever drifts, someone made a tier pay a flat
// number of credits again.
{
  const rtps = CONFIG.betLevels.map((level) => {
    const machine = new SlotMachine(CONFIG, 2024)
    machine.betPerLine = level
    let won = 0
    const spins = 300_000
    for (let i = 0; i < spins; i++) {
      machine.next()
      won += machine.totalPayout
    }
    return won / (spins * machine.totalBet)
  })
  const spread = Math.max(...rtps) - Math.min(...rtps)
  const ok = spread === 0
  if (!ok) failures++
  console.log(
    `  ${ok ? 'pass' : 'FAIL'}  RTP is identical at every bet level (${CONFIG.betLevels.join('/')} per line): ` +
      rtps.map((r) => `${(r * 100).toFixed(2)}%`).join(' '),
  )
}

console.log('\nBonus selection\n')

const clip = (id: string, tier: Tier, timesPlayed = 0): VideoMeta =>
  ({ id, name: id, tier, timesPlayed, duration: 60, importedAt: 0, bytes: 0, fingerprint: id, width: 1, height: 1, poster: null as unknown as Blob })

const mixed = [clip('c', 'common'), clip('r', 'rare'), clip('l', 'legendary')]
check('Mini draws from Common', poolFor(mixed, 'mini').map((v) => v.id), ['c'])
check('Minor draws from Rare', poolFor(mixed, 'minor').map((v) => v.id), ['r'])
check('Major draws from Legendary', poolFor(mixed, 'major').map((v) => v.id), ['l'])

const commonOnly = [clip('a', 'common'), clip('b', 'common')]
check('an empty Rare pool falls through to Common', poolFor(commonOnly, 'minor').map((v) => v.id), ['a', 'b'])
check('an empty Legendary pool falls through to Common', poolFor(commonOnly, 'major').map((v) => v.id), ['a', 'b'])
check('no Common either still yields something', poolFor([clip('l', 'legendary')], 'minor').map((v) => v.id), ['l'])
check('an empty library yields an empty pool', poolFor([], 'mini'), [])
check('an empty pool picks nothing', pickVideo([], Math.random), null)

// A clip played nine times should come up a tenth as often as an unplayed one.
{
  const rng = mulberry32(7)
  const pool = [clip('fresh', 'common', 0), clip('worn', 'common', 9)]
  let fresh = 0
  const runs = 120_000
  for (let i = 0; i < runs; i++) if (pickVideo(pool, rng)!.id === 'fresh') fresh++
  const ratio = fresh / (runs - fresh)
  const ok = Math.abs(ratio - 10) < 0.6
  if (!ok) failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  inverse weighting: fresh picked ${ratio.toFixed(2)}x as often as nine-times-played (want ~10)`)
}

check('a clip shorter than the window plays whole', pickSlice(6, Math.random, 10), { offset: 0, length: 6 })
check('a clip exactly the window long plays whole', pickSlice(10, Math.random, 10), { offset: 0, length: 10 })
check('each tier asks for its own length', [CLIP_SECONDS.mini, CLIP_SECONDS.minor, CLIP_SECONDS.major], [10, 15, 30])
check('a 20s clip cannot fill a 30s Major window, so it plays whole', pickSlice(20, Math.random, CLIP_SECONDS.major), { offset: 0, length: 20 })

for (const [tier, length] of Object.entries(CLIP_SECONDS)) {
  const rng = mulberry32(3)
  let outside = 0
  const runs = 120_000
  for (let i = 0; i < runs; i++) {
    // Only clips long enough to hold the window; shorter ones play whole.
    const duration = length + 2 + rng() * 3600
    const slice = pickSlice(duration, rng, length)
    const trimmable = 0.95 * duration - length > 0.05 * duration
    if (slice.length !== length) outside++
    else if (slice.offset < 0 || slice.offset + slice.length > duration + 1e-9) outside++
    else if (trimmable && (slice.offset < 0.05 * duration - 1e-9 || slice.offset + length > 0.95 * duration + 1e-9)) outside++
  }
  check(`${runs.toLocaleString('en-GB')} ${tier} slices all land inside the trimmed window`, outside, 0)
}

{
  // A fresh offset every single time — nothing is cached per clip.
  const rng = mulberry32(99)
  const seen = new Set<number>()
  for (let i = 0; i < 500; i++) seen.add(pickSlice(3600, rng, CLIP_SECONDS.mini).offset)
  check('500 rolls on one clip give 500 distinct offsets', seen.size, 500)
}

check('slice timestamps format', [describeSlice(42), describeSlice(0), describeSlice(605)], ['0:42', '0:00', '10:05'])

console.log('\nhold and spin')

const HOLD = JADE_CONFIG.hold!
const JADE_CELLS = JADE_CONFIG.reels.length * JADE_CONFIG.rows

/** A Jade screen carrying exactly `coins` lanterns, packed from cell zero. */
function holdGrid(coins: number): Int8Array {
  const g = new Int8Array(JADE_CELLS).fill(L1)
  for (let i = 0; i < coins; i++) g[i] = COIN
  return g
}

{
  // One short of the trigger does nothing at all; the threshold itself fires.
  const below = resolveHold(JADE_CONFIG, 20, holdGrid(HOLD.triggerCount - 1), mulberry32(1))
  const at = resolveHold(JADE_CONFIG, 20, holdGrid(HOLD.triggerCount), mulberry32(1))
  check('one lantern short does not trigger', below, null)
  check('the trigger count triggers', at !== null, true)
  check('every trigger lantern locks with a value', at!.filled >= HOLD.triggerCount, true)
}

{
  // Values only ever come from the table, and the payout is the board's sum
  // plus the full-board bonus when the board fills.
  const bet = 20
  const allowed = new Set(HOLD.values.map((v) => v.multiple * bet))
  let stray = 0
  let mismatched = 0
  let filledCounts = 0
  const rng = mulberry32(7)
  for (let i = 0; i < 20_000; i++) {
    const r = resolveHold(JADE_CONFIG, bet, holdGrid(HOLD.triggerCount), rng)!
    const lit = r.cells.filter((c) => c > 0)
    if (lit.some((c) => !allowed.has(c))) stray++
    if (lit.length !== r.filled) filledCounts++
    const sum = lit.reduce((a, b) => a + b, 0) + (r.fullBoard ? HOLD.fullBoardMultiple * bet : 0)
    if (sum !== r.payout) mismatched++
  }
  check('20,000 features use only paytable values', stray, 0)
  check('20,000 features agree with their own filled count', filledCounts, 0)
  check('20,000 payouts equal the board plus any full-board bonus', mismatched, 0)
}

{
  // A new lantern restores the full respin count; a quiet round spends one.
  const rng = mulberry32(11)
  let restored = 0
  let spent = 0
  let overrun = 0
  for (let i = 0; i < 20_000; i++) {
    const r = resolveHold(JADE_CONFIG, 20, holdGrid(HOLD.triggerCount), rng)!
    let quiet = 0
    for (const round of r.rounds) {
      if (round.landed.length > 0) {
        if (round.respinsLeft === HOLD.respins) restored++
        quiet = 0
      } else {
        quiet++
        if (round.respinsLeft === HOLD.respins - quiet) spent++
      }
      if (quiet > HOLD.respins) overrun++
    }
  }
  const rounds = restored + spent
  check('every round either restores or spends a respin', rounds > 0 && overrun === 0, true)
}

{
  // A board that is already full has nowhere to respin: it pays out at once.
  const r = resolveHold(JADE_CONFIG, 20, holdGrid(JADE_CELLS), mulberry32(3))!
  check('a full trigger screen needs no respins', r.rounds.length, 0)
  check('a full trigger screen is a full board', r.fullBoard, true)
  check('a full board adds its bonus', r.payout >= HOLD.fullBoardMultiple * 20, true)
}

{
  // Value weighting follows the table. The rarest lantern is the biggest.
  const rng = mulberry32(5)
  const runs = 200_000
  const tally = new Map<number, number>()
  for (let i = 0; i < runs; i++) {
    const v = pickValue(HOLD, 1, rng)
    tally.set(v, (tally.get(v) ?? 0) + 1)
  }
  const weightTotal = HOLD.values.reduce((sum, v) => sum + v.weight, 0)
  let off = 0
  for (const v of HOLD.values) {
    const seen = (tally.get(v.multiple) ?? 0) / runs
    if (Math.abs(seen - v.weight / weightTotal) > 0.005) off++
  }
  check(`${runs.toLocaleString('en-GB')} lantern values match their weights`, off, 0)
  check('every paytable value shows up', tally.size, HOLD.values.length)
}

{
  // The feature is Jade's alone, and lanterns never reach a paytable.
  check('only Jade runs hold and spin', [CONFIG.hold, EMBER_CONFIG.hold], [undefined, undefined])
  // The lantern carries its own credit value, so it must never also pay a way.
  const coinRow = JADE_CONFIG.paytable[COIN] ?? []
  check('lanterns pay nothing on the reels', coinRow.filter((v) => v !== 0).length, 0)
  const coinBoard = new Int8Array(JADE_CELLS).fill(COIN)
  check('a screen of nothing but lanterns wins nothing', evaluateWaysTotal(coinBoard, JADE_CONFIG, 20), 0)
}

console.log('\nfree spins')

const FREE_CFG = GILT_CONFIG.free!
const GILT_CELLS = GILT_CONFIG.reels.length * GILT_CONFIG.rows

/** A draw that pays `basePay` and shows `frees` vault symbols. */
const draw = (basePay: number, frees = 0) => {
  const grid = new Int8Array(GILT_CELLS).fill(L1)
  for (let i = 0; i < frees; i++) grid[i] = FREE
  return { stops: [0, 0, 0], grid, basePay }
}

{
  // The multiplier starts at one, and only a paying spin moves it on. Four
  // paying spins in a row are worth 1x, 2x, 3x then 4x.
  const paying = resolveFree(GILT_CONFIG, () => draw(10))!
  check('a round plays its awarded spins', paying.played, FREE_CFG.spins)
  check('the multiplier starts at one', paying.spins[0]!.multiplier, 1)
  check('it ratchets one step per paying spin', paying.spins.slice(0, 4).map((s) => s.multiplier), [1, 2, 3, 4])
  check(
    'the round pays the sum of its multiplied spins',
    paying.total,
    paying.spins.reduce((sum, s) => sum + s.basePay * s.multiplier, 0),
  )
}

{
  // A spin that pays nothing leaves the multiplier alone: a cold streak costs
  // progress rather than undoing it.
  let n = 0
  const alternating = resolveFree(GILT_CONFIG, () => draw(n++ % 2 === 0 ? 10 : 0))!
  check('a dry spin does not ratchet', alternating.spins.map((s) => s.multiplier), [1, 2, 2, 3, 3, 4, 4, 5])
  const dry = resolveFree(GILT_CONFIG, () => draw(0))!
  check('a round that never pays stays at one', dry.finalMultiplier, 1)
  check('a round that never pays is worth nothing', dry.total, 0)
}

{
  // The cap holds however long the round runs.
  const long = resolveFree({ ...GILT_CONFIG, free: { ...FREE_CFG, spins: 200 } }, () => draw(1))!
  check('the multiplier stops at the cap', long.finalMultiplier, FREE_CFG.multiplierCap)
  check('no spin exceeds the cap', long.spins.every((s) => s.multiplier <= FREE_CFG.multiplierCap), true)
}

{
  // A retrigger adds spins and leaves the climb alone.
  let n = 0
  const retriggered = resolveFree(GILT_CONFIG, () => draw(0, n++ === 0 ? FREE_CFG.trigger : 0))!
  check('a retrigger adds its spins', retriggered.played, FREE_CFG.spins + FREE_CFG.retrigger)
  check('the retrigger is recorded on the spin that did it', retriggered.spins[0]!.added, FREE_CFG.retrigger)
  check('a retrigger does not touch the multiplier', retriggered.finalMultiplier, 1)
  // One short of the trigger adds nothing.
  const near = resolveFree(GILT_CONFIG, () => draw(0, FREE_CFG.trigger - 1))!
  check('one vault short adds no spins', near.played, FREE_CFG.spins)
}

{
  // Spins left counts down to zero and never lies about what is coming.
  const round = resolveFree(GILT_CONFIG, () => draw(0))!
  check('spins left counts down', round.spins.map((s) => s.spinsLeft), [7, 6, 5, 4, 3, 2, 1, 0])
}

{
  // The cabinet itself: only Gilt runs free spins, and the vault never pays.
  check('only Gilt runs free spins', [CONFIG.free, JADE_CONFIG.free, EMBER_CONFIG.free], [undefined, undefined, undefined])
  const freeRow = GILT_CONFIG.paytable[FREE] ?? []
  check('the vault pays nothing on the reels', freeRow.filter((v) => v !== 0).length, 0)
  const allVaults = new Int8Array(GILT_CELLS).fill(FREE)
  check('a screen of nothing but vaults wins nothing', evaluateWaysTotal(allVaults, GILT_CONFIG, 50), 0)
  check('counting vaults', [countFrees(allVaults), countFrees(new Int8Array(GILT_CELLS).fill(L1))], [GILT_CELLS, 0])
}

{
  // Three reels means one rung on the paytable, and every paying symbol has to
  // be on it — the multiplier only asks whether a spin paid, so a zero here
  // would quietly break the tuner's assumption that the round stays linear.
  const rungs = new Set(GILT_CONFIG.paytable.map((row) => row.length))
  check('the whole paytable is one rung deep', [...rungs], [1])
  const paying = [L1, L2, L3, L4, M1, M2].map((id) => GILT_CONFIG.paytable[id]![0]!)
  check('every paying symbol pays something', paying.filter((p) => p <= 0).length, 0)
}

{
  // The vault is earned with a Major, and nothing else opens it.
  const gilt = MACHINES.find((m) => m.id === 'gilt-vault')!
  const none = emptyTotals()
  const ground = { ...emptyTotals(), wagered: 10_000_000, spins: 1_000_000 }
  const won = { ...emptyTotals(), tierCounts: { mini: 400, minor: 40, major: 1 } }
  check('the vault starts locked', isEarned(gilt, none), false)
  check('turnover alone does not open it', isEarned(gilt, ground), false)
  check('one Major opens it', isEarned(gilt, won), true)
  check('the vault is built', gilt.config !== null, true)
}

console.log('\nclips on the reels')

{
  // A screened clip becomes the face of a wild. It is only a face — the deal
  // must never touch anything that is not a wild.
  for (const [name, config] of [['Oxblood', CONFIG], ['Jade', JADE_CONFIG], ['Ember', EMBER_CONFIG], ['Gilt', GILT_CONFIG]] as const) {
    const strips = buildStrips(config)
    const deal = dealStills(strips, (symbol) => symbol === WILD, 4)
    let misplaced = 0
    let wilds = 0
    strips.forEach((strip, reel) => {
      strip.symbols.forEach((symbol, at) => {
        const dealt = deal[reel]![at]!
        if (symbol === WILD) {
          wilds++
          if (dealt < 0 || dealt >= 4) misplaced++
        } else if (dealt !== -1) misplaced++
      })
    })
    check(`${name}: only wilds wear a clip`, misplaced, 0)
    check(`${name} has wilds to wear them`, wilds > 0, true)
  }
}

{
  // Evenness is the whole reason the deal runs in strip order instead of using
  // the position modulo the library size. No clip may take more than one more
  // wild than any other, at any library size, on any cabinet.
  let worst = 0
  for (const config of [CONFIG, JADE_CONFIG, EMBER_CONFIG, GILT_CONFIG]) {
    const strips = buildStrips(config)
    for (const clips of [1, 2, 3, 4, 5, 8, 12]) {
      const deal = dealStills(strips, (symbol) => symbol === WILD, clips)
      const tally = new Array<number>(clips).fill(0)
      for (const row of deal) for (const v of row) if (v >= 0) tally[v]! += 1
      worst = Math.max(worst, Math.max(...tally) - Math.min(...tally))
    }
  }
  check('no clip takes more than one wild more than any other', worst <= 1, true)
}

{
  // An empty library leaves every symbol alone, which is what a new player sees.
  const strips = buildStrips(CONFIG)
  const deal = dealStills(strips, (symbol) => symbol === WILD, 0)
  check('no clips means no stills', deal.every((row) => row.every((v) => v === -1)), true)
}

{
  // The cadence that decides how often a clip plays at all.
  const cabinets = [CONFIG, JADE_CONFIG, EMBER_CONFIG, GILT_CONFIG]
  check('every cabinet keeps the same bonus cadence', cabinets.map((c) => [c.pitySpins, c.cooldownSpins]), cabinets.map(() => [30, 3]))
  check('the Mini pays four times the bet everywhere', cabinets.map((c) => c.tiers[0]!.payMultiple), [4, 4, 4, 4])
  // The guarantee the stats page states, restated as a test.
  check('a drought can never outrun pity plus cooldown', cabinets.map((c) => c.pitySpins + c.cooldownSpins), [33, 33, 33, 33])
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
