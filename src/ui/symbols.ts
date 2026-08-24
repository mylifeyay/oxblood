/**
 * Symbol faces are per machine — see `skins.ts`. This holds only the shape they
 * share and the class suffix each symbol id maps to.
 */
export interface SymbolFace {
  readonly glyph: string
  /** Drives the plate treatment: higher tiers get more weight on screen. */
  readonly kind: 'low' | 'medium' | 'wild' | 'scatter'
  readonly label: string
}

/** CSS modifier suffix for a symbol id, e.g. 'l1'. */
export const FACE_CLASS: readonly string[] = ['l1', 'l2', 'l3', 'l4', 'm1', 'm2', 'wild', 'scatter']
