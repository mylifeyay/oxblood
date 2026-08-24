import { L1, L2, L3, L4, M1, M2, WILD, SCATTER } from '../game/symbols.ts'

/**
 * Placeholder symbol faces. Deliberately typographic rather than illustrated —
 * the brief says not to spend time on art, and glyphs in the cabinet palette
 * read better than emoji against oxblood. Swap `glyph` for an <img> later
 * without touching anything else.
 */
export interface SymbolFace {
  readonly glyph: string
  /** Drives the plate treatment: higher tiers get more weight on screen. */
  readonly kind: 'low' | 'medium' | 'wild' | 'scatter'
  readonly label: string
}

export const FACES: readonly SymbolFace[] = (() => {
  const f: SymbolFace[] = new Array(8).fill(null)
  f[L1] = { glyph: '♠', kind: 'low', label: 'spade' }
  f[L2] = { glyph: '♥', kind: 'low', label: 'heart' }
  f[L3] = { glyph: '♦', kind: 'low', label: 'diamond' }
  f[L4] = { glyph: '♣', kind: 'low', label: 'club' }
  f[M1] = { glyph: '★', kind: 'medium', label: 'star' }
  f[M2] = { glyph: '⬢', kind: 'medium', label: 'hexagon' }
  f[WILD] = { glyph: 'W', kind: 'wild', label: 'wild' }
  f[SCATTER] = { glyph: '✦', kind: 'scatter', label: 'scatter' }
  return f
})()

/** CSS modifier suffix for a symbol id, e.g. 'l1'. */
export const FACE_CLASS: readonly string[] = ['l1', 'l2', 'l3', 'l4', 'm1', 'm2', 'wild', 'scatter']
