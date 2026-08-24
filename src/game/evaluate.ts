import { SCATTER, WILD } from './symbols.ts'
import { LINE_COUNT, PAYLINES, REELS, ROWS } from './paylines.ts'
import type { GameConfig } from './config.ts'

export interface LineWin {
  readonly line: number
  readonly symbol: number
  readonly count: number
  /** Credits, already multiplied by bet-per-line. */
  readonly pay: number
}

// Scratch for the last scanned line. Module level so the hot loop allocates
// nothing; the caller reads it immediately after scanLine returns.
let lastSymbol = -1
let lastCount = 0

/**
 * Scores one payline, left to right from reel 1.
 *
 * A line pays the better of two readings: a run of pure WILDs on the WILD
 * paytable, or the leading symbol's run with WILDs substituting for it. That
 * matters because five WILDs pay 200 and five M2 pay 25 — the same five cells
 * must pay the larger. SCATTER never counts on a line and breaks any run.
 *
 * Returns the payout in bet-per-line multiples, and leaves the winning symbol
 * and run length in the module scratch.
 */
function scanLine(grid: Int8Array, line: number, paytable: GameConfig['paytable']): number {
  const base = line * REELS
  lastSymbol = -1
  lastCount = 0

  // Leading WILDs, which both readings share.
  let wilds = 0
  while (wilds < REELS && grid[wilds * ROWS + PAYLINES[base + wilds]!] === WILD) wilds++

  let best = 0
  if (wilds >= 3) {
    best = paytable[WILD]![wilds - 3]!
    lastSymbol = WILD
    lastCount = wilds
  }

  if (wilds < REELS) {
    const symbol = grid[wilds * ROWS + PAYLINES[base + wilds]!]!
    if (symbol !== SCATTER) {
      let run = wilds + 1
      while (run < REELS) {
        const next = grid[run * ROWS + PAYLINES[base + run]!]!
        if (next !== symbol && next !== WILD) break
        run++
      }
      if (run >= 3) {
        const pay = paytable[symbol]![run - 3]!
        if (pay > best) {
          best = pay
          lastSymbol = symbol
          lastCount = run
        }
      }
    }
  }

  return best
}

/** Total line payout in credits. Allocation free — this is the simulator path. */
export function evaluateLineTotal(grid: Int8Array, config: GameConfig, betPerLine: number): number {
  let total = 0
  for (let line = 0; line < LINE_COUNT; line++) total += scanLine(grid, line, config.paytable)
  return total * betPerLine
}

/** Same scoring, with the per-line detail the reel display needs. */
export function evaluateLines(grid: Int8Array, config: GameConfig, betPerLine: number): { total: number; wins: LineWin[] } {
  const wins: LineWin[] = []
  let total = 0
  for (let line = 0; line < LINE_COUNT; line++) {
    const pay = scanLine(grid, line, config.paytable)
    if (pay > 0) {
      total += pay
      wins.push({ line, symbol: lastSymbol, count: lastCount, pay: pay * betPerLine })
    }
  }
  return { total: total * betPerLine, wins }
}

export function countScatters(grid: Int8Array): number {
  let n = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] === SCATTER) n++
  return n
}
