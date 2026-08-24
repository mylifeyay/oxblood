import { CONFIG, type GameConfig } from './config.ts'
import { JADE_CONFIG } from './jade.ts'
import { EMBER_CONFIG } from './ember.ts'
import { GILT_CONFIG } from './gilt.ts'
import type { Totals } from './ledger.ts'

/**
 * What a cabinet is earned with.
 *
 * Spend and time, the way a casino counts you — and, for the last room, one
 * thing that cannot be ground out at all: a Major. You do not get into the
 * vault by turning up. You get in by winning the biggest thing on the floor.
 */
export type UnlockMetric = 'wagered' | 'spins' | 'majors'

export interface Unlock {
  readonly metric: UnlockMetric
  readonly at: number
}

/**
 * The cabinet registry.
 *
 * A machine carries its own payout config and its own unlock condition, so
 * adding one is data plus a skin rather than a rewrite. The thresholds are
 * deliberately not shown anywhere in the interface — the bar fills, and that
 * is all the player gets.
 */
export interface MachineDef {
  readonly id: string
  readonly name: string
  readonly tagline: string
  /** Key into the UI skin table, and the CSS theme attribute. */
  readonly theme: string
  readonly accent: string
  readonly unlock: Unlock
  /** Null until the machine is actually built. */
  readonly config: GameConfig | null
}

export const MACHINES: readonly MachineDef[] = [
  {
    id: 'oxblood',
    name: 'Oxblood',
    tagline: 'Ten lines, brass and lacquer',
    theme: 'oxblood',
    accent: '#C89B3F',
    unlock: { metric: 'spins', at: 0 },
    config: CONFIG,
  },
  {
    id: 'jade-parlour',
    name: 'Jade Parlour',
    tagline: 'Two hundred and forty-three ways',
    theme: 'jade',
    accent: '#7FE3C0',
    unlock: { metric: 'wagered', at: 25_000 },
    config: JADE_CONFIG,
  },
  {
    id: 'ember-room',
    name: 'Ember Room',
    tagline: 'Six reels, four rows, and a pot that keeps climbing',
    theme: 'ember',
    accent: '#FF7A45',
    unlock: { metric: 'spins', at: 1_500 },
    config: EMBER_CONFIG,
  },
  {
    id: 'gilt-vault',
    name: 'Gilt Vault',
    tagline: 'Twenty-seven ways, and free spins that build',
    theme: 'gilt',
    accent: '#E8B94A',
    unlock: { metric: 'majors', at: 1 },
    config: GILT_CONFIG,
  },
]

export const DEFAULT_MACHINE = MACHINES[0]!

export const machineById = (id: string): MachineDef => MACHINES.find((m) => m.id === id) ?? DEFAULT_MACHINE

const progressOf = (unlock: Unlock, lifetime: Totals): number => {
  if (unlock.metric === 'wagered') return lifetime.wagered
  if (unlock.metric === 'majors') return lifetime.tierCounts.major
  return lifetime.spins
}

/** Zero to one. Never shown as a number, only as a bar. */
export const unlockProgress = (machine: MachineDef, lifetime: Totals): number =>
  machine.unlock.at <= 0 ? 1 : Math.min(1, progressOf(machine.unlock, lifetime) / machine.unlock.at)

export const isEarned = (machine: MachineDef, lifetime: Totals): boolean =>
  progressOf(machine.unlock, lifetime) >= machine.unlock.at

/** Earned and actually built. */
export const isPlayable = (machine: MachineDef, lifetime: Totals): boolean =>
  machine.config !== null && isEarned(machine, lifetime)

/** Every machine that is built and earned, in registry order. */
export const playableMachines = (lifetime: Totals): MachineDef[] =>
  MACHINES.filter((m) => isPlayable(m, lifetime))
