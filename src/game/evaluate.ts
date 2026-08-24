import { SCATTER, SYMBOL_COUNT, WILD } from './symbols.ts'
import { LINE_COUNT, PAYLINES, REELS } from './paylines.ts'
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
function scanLine(grid: Int8Array, line: number, config: GameConfig): number {
  const paytable = config.paytable
  const rows = config.rows
  const base = line * REELS
  lastSymbol = -1
  lastCount = 0

  // Leading WILDs, which both readings share.
  let wilds = 0
  while (wilds < REELS && grid[wilds * rows + PAYLINES[base + wilds]!] === WILD) wilds++

  let best = 0
  if (wilds >= 3) {
    best = paytable[WILD]![wilds - 3]!
    lastSymbol = WILD
    lastCount = wilds
  }

  if (wilds < REELS) {
    const symbol = grid[wilds * rows + PAYLINES[base + wilds]!]!
    if (symbol !== SCATTER) {
      let run = wilds + 1
      while (run < REELS) {
        const next = grid[run * rows + PAYLINES[base + run]!]!
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
  for (let line = 0; line < LINE_COUNT; line++) total += scanLine(grid, line, config)
  return total * betPerLine
}

/** Same scoring, with the per-line detail the reel display needs. */
export function evaluateLines(grid: Int8Array, config: GameConfig, betPerLine: number): { total: number; wins: LineWin[] } {
  const wins: LineWin[] = []
  let total = 0
  for (let line = 0; line < LINE_COUNT; line++) {
    const pay = scanLine(grid, line, config)
    if (pay > 0) {
      total += pay
      wins.push({ line, symbol: lastSymbol, count: lastCount, pay: pay * betPerLine })
    }
  }
  return { total: total * betPerLine, wins }
}

/**
 * Ways scoring.
 *
 * A symbol pays when it lands on consecutive reels starting at reel 1, and the
 * win is multiplied by how many places it appears on each of those reels. Five
 * reels of three rows is 3^5 = 243 ways. Every symbol is scored independently,
 * so one screen can pay several times over.
 *
 * WILD substitutes here but has no payout of its own — otherwise a screen full
 * of wilds would pay once for every symbol it stood in for and once again as
 * itself.
 */
function scanWays(grid: Int8Array, symbol: number, config: GameConfig): { pay: number; reels: number; ways: number } {
  const paytable = config.paytable
  const rows = config.rows
  let ways = 1
  let reels = 0

  for (let reel = 0; reel < config.reels.length; reel++) {
    let here = 0
    for (let row = 0; row < rows; row++) {
      const cell = grid[reel * rows + row]!
      if (cell === symbol || cell === WILD) here++
    }
    if (here === 0) break
    ways *= here
    reels++
  }

  if (reels < 3) return { pay: 0, reels, ways: 0 }
  return { pay: paytable[symbol]![reels - 3]! * ways, reels, ways }
}

/** Total ways payout in credits. Allocation free — the simulator path. */
export function evaluateWaysTotal(grid: Int8Array, config: GameConfig, betPerUnit: number): number {
  let total = 0
  for (let symbol = 0; symbol < SYMBOL_COUNT; symbol++) {
    if (symbol === WILD || symbol === SCATTER) continue
    total += scanWays(grid, symbol, config).pay
  }
  return total * betPerUnit
}

/** Same scoring, with the detail the reel display needs. */
export function evaluateWays(grid: Int8Array, config: GameConfig, betPerUnit: number): { total: number; wins: LineWin[] } {
  const wins: LineWin[] = []
  let total = 0
  for (let symbol = 0; symbol < SYMBOL_COUNT; symbol++) {
    if (symbol === WILD || symbol === SCATTER) continue
    const { pay, reels } = scanWays(grid, symbol, config)
    if (pay <= 0) continue
    total += pay
    // `line` carries the symbol for ways wins; there are no fixed lines.
    wins.push({ line: symbol, symbol, count: reels, pay: pay * betPerUnit })
  }
  return { total: total * betPerUnit, wins }
}

/** Scores a screen whichever way this machine counts. */
export function evaluateTotal(grid: Int8Array, config: GameConfig, bet: number): number {
  return config.evaluation === 'ways' ? evaluateWaysTotal(grid, config, bet) : evaluateLineTotal(grid, config, bet)
}

export function evaluateDetail(grid: Int8Array, config: GameConfig, bet: number): { total: number; wins: LineWin[] } {
  return config.evaluation === 'ways' ? evaluateWays(grid, config, bet) : evaluateLines(grid, config, bet)
}

export function countScatters(grid: Int8Array): number {
  let n = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] === SCATTER) n++
  return n
}
