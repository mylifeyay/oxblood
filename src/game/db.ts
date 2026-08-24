import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { LedgerEntry, Totals } from './ledger.ts'
import type { VideoMeta } from './videos.ts'

/**
 * One database for everything that has to survive a reload. Video blobs live
 * here and nowhere else — never localStorage, which could not hold them anyway.
 */
export interface OxbloodDB extends DBSchema {
  ledger: { key: number; value: LedgerEntry }
  meta: { key: string; value: Totals }
  videos: {
    key: string
    value: VideoMeta
    indexes: { 'by-fingerprint': string; 'by-tier': string }
  }
  videoBlobs: { key: string; value: Blob }
  settings: { key: string; value: unknown }
}

export type Db = IDBPDatabase<OxbloodDB>

export const DB_NAME = 'oxblood'
export const DB_VERSION = 3

let opening: Promise<Db | null> | null = null

/** Resolves to null rather than throwing, so the game still runs unpersisted. */
export function database(): Promise<Db | null> {
  opening ??= open()
  return opening
}

async function open(): Promise<Db | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    return await openDB<OxbloodDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          // Out-of-line auto-increment keys keep LedgerEntry exactly the shape
          // the design calls for, with no storage id smuggled into it.
          db.createObjectStore('ledger', { autoIncrement: true })
          db.createObjectStore('meta')
        }
        if (oldVersion < 2) {
          const videos = db.createObjectStore('videos', { keyPath: 'id' })
          videos.createIndex('by-fingerprint', 'fingerprint', { unique: false })
          videos.createIndex('by-tier', 'tier', { unique: false })
          db.createObjectStore('videoBlobs')
        }
        if (oldVersion < 3) {
          db.createObjectStore('settings')
        }
      },
    })
  } catch (error) {
    console.warn('IndexedDB is unavailable, so nothing will persist this session', error)
    return null
  }
}
