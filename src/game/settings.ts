import { database } from './db.ts'

/**
 * Small preferences. In IndexedDB rather than localStorage, so there is exactly
 * one place anything persists.
 */
export async function loadSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await database()
  if (!db) return fallback
  try {
    const value = await db.get('settings', key)
    return value === undefined ? fallback : (value as T)
  } catch {
    return fallback
  }
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  const db = await database()
  if (!db) return
  try {
    await db.put('settings', value, key)
  } catch {
    // A preference failing to save is not worth interrupting play for.
  }
}
