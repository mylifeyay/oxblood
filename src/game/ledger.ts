/**
 * The ledger is append-only. Nothing in the game keeps a mutable balance —
 * balance, net and observed RTP are all folded out of these entries.
 *
 * The fold is materialised in memory so the spin path stays synchronous, but it
 * is only ever advanced by appending an entry. There is no setter anywhere.
 */

export type WinKind = 'line' | 'mini' | 'minor' | 'major'
export type TierKind = Exclude<WinKind, 'line'>

export const TIER_KINDS: readonly TierKind[] = ['mini', 'minor', 'major']

export type LedgerEntry =
  | { t: 'credit'; amount: number; at: number }
  | { t: 'wager'; amount: number; at: number }
  | { t: 'win'; amount: number; at: number; kind: WinKind }

/** A stored entry carries the key IndexedDB assigned it. */
export type StoredEntry = LedgerEntry & { id: number }

export interface Totals {
  added: number
  wagered: number
  won: number
  wonByKind: Record<WinKind, number>
  spins: number
  tierCounts: Record<TierKind, number>
  biggestWin: number
  /** Running total for the spin in progress, so a line win and a bonus on the
   *  same spin count as one win rather than two. */
  spinWin: number
  /** Spins since the last Mini, including the one in progress. */
  sinceMini: number
  /** Spins since a bonus of any tier. Restores the cooldown across a reload. */
  sinceBonus: number
  longestMiniDrought: number
}

/** Stands in for "no bonus has ever landed", without reaching for Infinity. */
export const LONG_AGO = 1e9

export function emptyTotals(): Totals {
  return {
    added: 0,
    wagered: 0,
    won: 0,
    wonByKind: { line: 0, mini: 0, minor: 0, major: 0 },
    spins: 0,
    tierCounts: { mini: 0, minor: 0, major: 0 },
    biggestWin: 0,
    spinWin: 0,
    sinceMini: 0,
    sinceBonus: LONG_AGO,
    longestMiniDrought: 0,
  }
}

export function cloneTotals(t: Totals): Totals {
  return { ...t, wonByKind: { ...t.wonByKind }, tierCounts: { ...t.tierCounts } }
}

/** Advances a fold by one entry. The only way totals ever change. */
export function apply(t: Totals, entry: LedgerEntry): void {
  switch (entry.t) {
    case 'credit':
      t.added += entry.amount
      break

    case 'wager':
      t.wagered += entry.amount
      t.spins += 1
      t.sinceMini += 1
      t.sinceBonus = Math.min(t.sinceBonus + 1, LONG_AGO)
      t.spinWin = 0
      break

    case 'win': {
      t.won += entry.amount
      t.wonByKind[entry.kind] += entry.amount
      t.spinWin += entry.amount
      if (t.spinWin > t.biggestWin) t.biggestWin = t.spinWin

      if (entry.kind !== 'line') {
        t.tierCounts[entry.kind] += 1
        t.sinceBonus = 0
        if (entry.kind === 'mini') {
          // sinceMini already counted the spin this Mini landed on.
          const drought = Math.max(0, t.sinceMini - 1)
          if (drought > t.longestMiniDrought) t.longestMiniDrought = drought
          t.sinceMini = 0
        }
      }
      break
    }
  }
}

export function foldAll(base: Totals, entries: readonly LedgerEntry[]): Totals {
  const out = cloneTotals(base)
  for (const entry of entries) apply(out, entry)
  return out
}

export const balanceOf = (t: Totals): number => t.added + t.won - t.wagered
export const netOf = (t: Totals): number => t.won - t.wagered
export const rtpOf = (t: Totals): number | null => (t.wagered > 0 ? t.won / t.wagered : null)
