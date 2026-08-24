import { COIN } from './symbols.ts'
import type { GameConfig } from './config.ts'

/**
 * Hold and spin.
 *
 * Land enough lanterns on the base screen and they lock in place. Everything
 * else clears, and you get a handful of respins in which only lanterns can
 * land. Every new one resets the count, so the feature runs until the board
 * goes quiet — or fills, which pays on top.
 *
 * The whole thing is a pure function of a random source, so it can be simulated
 * ten million times exactly as it will be played.
 */
export interface HoldValue {
  /** Credit value as a multiple of the total bet. */
  readonly multiple: number
  readonly weight: number
}

export interface HoldConfig {
  /** Lanterns needed on the base screen to start it. */
  readonly triggerCount: number
  /** Respins granted, and restored every time a new lantern lands. */
  readonly respins: number
  readonly values: readonly HoldValue[]
  /** Chance an empty cell catches a lantern on a respin. */
  readonly landChance: number
  /** Paid on top, as a multiple of the total bet, for filling every cell. */
  readonly fullBoardMultiple: number
}

export interface HoldRound {
  /** Cells that caught a lantern this round, and what each was worth. */
  readonly landed: { cell: number; value: number }[]
  readonly respinsLeft: number
}

export interface HoldResult {
  /** Credit value in every cell; zero where there is no lantern. */
  readonly cells: number[]
  /** How the board filled, round by round, for the presentation to replay. */
  readonly rounds: HoldRound[]
  readonly filled: number
  readonly fullBoard: boolean
  readonly payout: number
}

/** Picks a lantern value in credits. */
export function pickValue(hold: HoldConfig, totalBet: number, random: () => number): number {
  const total = hold.values.reduce((sum, v) => sum + v.weight, 0)
  let ticket = random() * total
  for (const v of hold.values) {
    ticket -= v.weight
    if (ticket <= 0) return v.multiple * totalBet
  }
  return hold.values[hold.values.length - 1]!.multiple * totalBet
}

/** True when the base screen has earned the feature. */
export function countCoins(grid: Int8Array): number {
  let n = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] === COIN) n++
  return n
}

/**
 * Runs the feature to its end. `grid` is the triggering screen; every lantern
 * on it locks with a value, and the respins fill in from there.
 */
export function resolveHold(config: GameConfig, totalBet: number, grid: Int8Array, random: () => number): HoldResult | null {
  const hold = config.hold
  if (!hold) return null

  const size = grid.length
  const cells = new Array<number>(size).fill(0)
  let filled = 0

  for (let i = 0; i < size; i++) {
    if (grid[i] !== COIN) continue
    cells[i] = pickValue(hold, totalBet, random)
    filled++
  }
  if (filled < hold.triggerCount) return null

  const rounds: HoldRound[] = []
  let respins = hold.respins

  while (respins > 0 && filled < size) {
    const landed: { cell: number; value: number }[] = []
    for (let i = 0; i < size; i++) {
      if (cells[i] !== 0) continue
      if (random() >= hold.landChance) continue
      cells[i] = pickValue(hold, totalBet, random)
      landed.push({ cell: i, value: cells[i]! })
      filled++
    }
    // A single new lantern buys the full count back.
    respins = landed.length > 0 ? hold.respins : respins - 1
    rounds.push({ landed, respinsLeft: respins })
  }

  const fullBoard = filled >= size
  let payout = cells.reduce((sum, v) => sum + v, 0)
  if (fullBoard) payout += hold.fullBoardMultiple * totalBet

  return { cells, rounds, filled, fullBoard, payout: Math.round(payout) }
}
