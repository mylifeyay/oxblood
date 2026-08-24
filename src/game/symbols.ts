/**
 * Symbols stay abstract so they can be skinned later. Everything downstream
 * works in numeric ids, which keeps the hot loop free of string comparison.
 */

export const SYMBOL_NAMES = ['L1', 'L2', 'L3', 'L4', 'M1', 'M2', 'WILD', 'SCATTER'] as const

export type SymbolName = (typeof SYMBOL_NAMES)[number]

export const L1 = 0
export const L2 = 1
export const L3 = 2
export const L4 = 3
export const M1 = 4
export const M2 = 5
export const WILD = 6
export const SCATTER = 7

export const SYMBOL_COUNT = 8

/** WILD substitutes for everything except SCATTER. */
export function substitutes(symbol: number, forSymbol: number): boolean {
  return symbol === forSymbol || (symbol === WILD && forSymbol !== SCATTER)
}
