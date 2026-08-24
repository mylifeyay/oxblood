/**
 * Assertions over the payout engine. The Monte Carlo tells you the aggregate
 * is plausible; these tell you the rules are actually the rules.
 */
import { CONFIG } from '../src/game/config.ts'
import { SlotMachine } from '../src/game/machine.ts'
import { L1, L4, M1, M2, WILD, SCATTER } from '../src/game/symbols.ts'
import { evaluateLines, countScatters } from '../src/game/evaluate.ts'
import { buildStrips } from '../src/game/reels.ts'
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

  const tally = new Array<number>(8).fill(0)
  for (const symbol of strip.symbols) tally[symbol]!++
  check(`reel ${reel + 1} symbol counts match its weights`, tally, [...CONFIG.reels[reel]!.weights])
})

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

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
