/**
 * Symbols stay abstract so they can be skinned later. Everything downstream
 * works in numeric ids, which keeps the hot loop free of string comparison.
 */

export const SYMBOL_NAMES = ['L1', 'L2', 'L3', 'L4', 'M1', 'M2', 'WILD', 'SCATTER', 'COIN', 'FREE'] as const

export type SymbolName = (typeof SYMBOL_NAMES)[number]

export const L1 = 0
export const L2 = 1
export const L3 = 2
export const L4 = 3
export const M1 = 4
export const M2 = 5
export const WILD = 6
export const SCATTER = 7
/**
 * The hold-and-spin symbol. It never pays on a line or a way — it carries its
 * own credit value and only matters to machines that run the feature.
 */
export const COIN = 8
/**
 * The free-spins scatter. A second scatter, separate from the one that pays the
 * tiers: this one buys spins rather than credits, and never pays by itself.
 */
export const FREE = 9

export const SYMBOL_COUNT = 10

/** WILD substitutes for everything except SCATTER. */
export function substitutes(symbol: number, forSymbol: number): boolean {
  return symbol === forSymbol || (symbol === WILD && forSymbol !== SCATTER)
}
