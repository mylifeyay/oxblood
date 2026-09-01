import { SCATTER } from './symbols.ts'
import { mulberry32, shuffle, type Rng } from './random.ts'
import type { GameConfig, ReelSpec } from './config.ts'


export interface Strip {
  /** The strip itself, one symbol id per position. */
  readonly symbols: Int8Array
  /**
   * The strip with its first ROWS-1 positions repeated on the end, so a window
   * read at any stop index needs no modulo. Indexed directly by the evaluator.
   */
  readonly wrapped: Int8Array
  readonly length: number
}

/**
 * Builds one reel strip for a window `rows` deep.
 *
 * Scatters are placed as deliberate groups — singles, or adjacent pairs — with
 * at least two filler positions between every group. That gap guarantees a
 * three-row window can never straddle two groups, which makes the number of
 * scatters a reel can show exactly analysable: a single is visible in three
 * windows and always alone, a pair is visible in four windows, showing two
 * scatters in two of them and one in the other two.
 */
export function buildStrip(spec: ReelSpec, rng: Rng, rows: number): Strip {
  const total = spec.weights.reduce((a, b) => a + b, 0)
  const scatters = spec.weights[SCATTER] ?? 0
  const pairs = spec.scatterPairs
  const singles = scatters - pairs * 2

  if (singles < 0) throw new Error(`scatterPairs ${pairs} needs ${pairs * 2} scatters, reel has ${scatters}`)

  const groups: number[] = [
    ...new Array<number>(pairs).fill(2),
    ...new Array<number>(singles).fill(1),
  ]
  shuffle(groups, rng)

  const fillerCount = total - scatters
  const gapCount = groups.length
  const minGap = rows - 1

  if (gapCount > 0 && fillerCount < gapCount * minGap) {
    throw new Error(`reel has ${fillerCount} non-scatter positions, needs ${gapCount * minGap} to space ${gapCount} scatter groups`)
  }

  // Every non-scatter symbol, shuffled, then dealt into the gaps.
  const filler: number[] = []
  spec.weights.forEach((count, symbol) => {
    if (symbol === SCATTER) return
    for (let i = 0; i < count; i++) filler.push(symbol)
  })
  shuffle(filler, rng)

  // Each gap gets the minimum, then the surplus is scattered at random.
  const gaps = new Array<number>(Math.max(gapCount, 1)).fill(gapCount > 0 ? minGap : fillerCount)
  if (gapCount > 0) {
    let surplus = fillerCount - gapCount * minGap
    while (surplus-- > 0) gaps[Math.floor(rng() * gapCount)]! += 1
  }

  const symbols = new Int8Array(total)
  let at = 0
  let take = 0
  for (let g = 0; g < gaps.length; g++) {
    for (let i = 0; i < gaps[g]!; i++) symbols[at++] = filler[take++]!
    const group = groups[g]
    if (group !== undefined) for (let i = 0; i < group; i++) symbols[at++] = SCATTER
  }

  // Rotate by a random offset so strips do not all begin with filler.
  const offset = Math.floor(rng() * total)
  const rotated = new Int8Array(total)
  for (let i = 0; i < total; i++) rotated[i] = symbols[(i + offset) % total]!

  const wrapped = new Int8Array(total + rows - 1)
  wrapped.set(rotated, 0)
  for (let i = 0; i < rows - 1; i++) wrapped[total + i] = rotated[i]!

  return { symbols: rotated, wrapped, length: total }
}

/** Deterministic from config.stripSeed, so the simulator tests what ships. */
export function buildStrips(config: GameConfig): Strip[] {
  const rng = mulberry32(config.stripSeed)
  return config.reels.map((spec) => buildStrip(spec, rng, config.rows))
}

/**
 * Deals a library of stills across the wilds of a whole cabinet.
 *
 * Returns, per reel, which still each strip position wears — and -1 wherever
 * the symbol is not a wild.
 *
 * The obvious mapping is the position modulo the library size, and it is wrong:
 * with a handful of clips and a couple of dozen wilds, the residues clump badly
 * enough that one clip takes half the wilds and another almost none. Dealing
 * them in strip order is even by construction. The deal runs across the whole
 * cabinet rather than restarting on each reel, because a single reel can hold
 * fewer wilds than the library holds clips, and restarting would mean the clips
 * past that never appeared at all.
 */
export function dealStills(strips: readonly Strip[], isWild: (symbol: number) => boolean, count: number): Int16Array[] {
  const out = strips.map((strip) => new Int16Array(strip.length).fill(-1))
  if (count <= 0) return out

  let dealt = 0
  strips.forEach((strip, reel) => {
    const row = out[reel]!
    for (let at = 0; at < strip.length; at++) {
      if (!isWild(strip.symbols[at]!)) continue
      row[at] = dealt++ % count
    }
  })
  return out
}
