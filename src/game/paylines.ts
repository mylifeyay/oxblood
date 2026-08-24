/**
 * Ten fixed paylines, evaluated left to right from reel 1.
 * Each entry is the row index (0 top, 1 middle, 2 bottom) on each of the five
 * reels. Flattened into one array because the evaluator runs ten million times.
 */

/**
 * The default grid. Oxblood and Jade are five by three; Ember is six by four.
 * A machine's own dimensions come from its config — these are the fallback and
 * the shape the fixed paylines below are drawn on.
 */
export const REELS = 5
export const ROWS = 3
export const LINE_COUNT = 10

export const PAYLINE_ROWS: readonly (readonly [number, number, number, number, number])[] = [
  [1, 1, 1, 1, 1], // straight through the middle
  [0, 0, 0, 0, 0], // top
  [2, 2, 2, 2, 2], // bottom
  [0, 1, 2, 1, 0], // V
  [2, 1, 0, 1, 2], // inverted V
  [0, 0, 1, 0, 0], // shallow dip from the top
  [2, 2, 1, 2, 2], // shallow rise from the bottom
  [1, 0, 0, 0, 1], // arch
  [1, 2, 2, 2, 1], // trough
  [0, 1, 0, 1, 0], // zigzag
]

/** Flat lookup: PAYLINES[line * REELS + reel] === row index. */
export const PAYLINES: Int8Array = (() => {
  const flat = new Int8Array(LINE_COUNT * REELS)
  for (let line = 0; line < LINE_COUNT; line++) {
    const rows = PAYLINE_ROWS[line]!
    for (let reel = 0; reel < REELS; reel++) flat[line * REELS + reel] = rows[reel]!
  }
  return flat
})()
