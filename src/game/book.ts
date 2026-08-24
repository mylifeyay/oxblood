import { database, type Db } from './db.ts'
import {
  apply,
  balanceOf,
  cloneTotals,
  emptyTotals,
  foldAll,
  type LedgerEntry,
  type Totals,
} from './ledger.ts'

/** Entries kept in full. Anything older is folded into a rolling total. */
export const MAX_ENTRIES = 10_000
/** Appends are batched into one transaction rather than one write per spin. */
const FLUSH_MS = 300
export const STARTING_CREDITS = 1000

/**
 * The append-only book.
 *
 * Balance, net and observed RTP are folds over the entries — there is no
 * setter for any of them. The fold is kept materialised in memory so the spin
 * path stays synchronous, and it is only ever advanced by `append`.
 */
export class Book {
  private db: Db | null = null
  private entries: LedgerEntry[] = []
  private keys: number[] = []
  private folded: Totals = emptyTotals()
  private life: Totals = emptyTotals()
  private sess: Totals = emptyTotals()
  private pending: LedgerEntry[] = []
  private flushHandle: number | null = null
  private writing: Promise<void> = Promise.resolve()

  static async open(): Promise<Book> {
    const book = new Book()
    await book.load()
    return book
  }

  private async load(): Promise<void> {
    this.db = await database()

    if (this.db) {
      try {
        this.folded = (await this.db.get('meta', 'folded')) ?? emptyTotals()
        this.keys = (await this.db.getAllKeys('ledger')) as number[]
        this.entries = await this.db.getAll('ledger')
      } catch (error) {
        console.warn('Could not read the ledger; starting from empty', error)
        this.folded = emptyTotals()
        this.keys = []
        this.entries = []
      }
    }

    this.life = foldAll(this.folded, this.entries)

    // A brand new book opens with the starting credit, recorded like anything
    // else so the balance still derives from entries alone.
    if (this.entries.length === 0 && this.folded.added === 0 && this.folded.wagered === 0) {
      this.append({ t: 'credit', amount: STARTING_CREDITS, at: Date.now() })
    }

    const flushNow = (): void => void this.flush()
    window.addEventListener('pagehide', flushNow)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow()
    })
  }

  /** Read-only views. Treat them as snapshots; never mutate. */
  get lifetime(): Totals {
    return this.life
  }

  get session(): Totals {
    return this.sess
  }

  get balance(): number {
    return balanceOf(this.life)
  }

  /** True when nothing is persisting, so the UI can say so honestly. */
  get ephemeral(): boolean {
    return this.db === null
  }

  append(entry: LedgerEntry): void {
    apply(this.life, entry)
    apply(this.sess, entry)
    this.pending.push(entry)
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushHandle !== null) return
    this.flushHandle = window.setTimeout(() => {
      this.flushHandle = null
      void this.flush()
    }, FLUSH_MS)
  }

  /** Serialised, so overlapping flushes cannot interleave their key bookkeeping. */
  private flush(): Promise<void> {
    this.writing = this.writing.then(() => this.writeBatch()).catch((error: unknown) => {
      console.warn('Ledger write failed', error)
    })
    return this.writing
  }

  private async writeBatch(): Promise<void> {
    const db = this.db
    if (!db || this.pending.length === 0) return

    const batch = this.pending
    this.pending = []

    const tx = db.transaction('ledger', 'readwrite')
    const written: number[] = []
    for (const entry of batch) written.push((await tx.store.add(entry)) as number)
    await tx.done

    this.entries.push(...batch)
    this.keys.push(...written)
    await this.prune()
  }

  /**
   * Folds the oldest entries into the rolling total and drops them, so the
   * ledger never grows without bound. The cut lands on a wager, which is where
   * a spin starts, so a spin's wager and its win are never split across the
   * boundary — that would break the biggest-single-win grouping.
   */
  private async prune(): Promise<void> {
    if (this.entries.length <= MAX_ENTRIES || !this.db) return

    let cut = this.entries.length - MAX_ENTRIES
    while (cut < this.entries.length && this.entries[cut]!.t !== 'wager') cut++
    if (cut === 0) return

    const doomedKeys = this.keys.slice(0, cut)
    this.folded = foldAll(this.folded, this.entries.slice(0, cut))
    this.entries = this.entries.slice(cut)
    this.keys = this.keys.slice(cut)

    const tx = this.db.transaction(['ledger', 'meta'], 'readwrite')
    const ledger = tx.objectStore('ledger')
    for (const key of doomedKeys) void ledger.delete(key)
    void tx.objectStore('meta').put(this.folded, 'folded')
    await tx.done
  }

  /** Entry count actually held, for the stats screen to be honest about pruning. */
  get retained(): number {
    return this.entries.length + this.pending.length
  }

  get foldedTotals(): Totals {
    return cloneTotals(this.folded)
  }
}
