import { CONFIG, type GameConfig } from './config.ts'

/**
 * The cabinet registry.
 *
 * There is one machine today. This exists so the second one is data rather than
 * a refactor: a machine carries its own name, accent and payout config, and the
 * game reads whichever is active. Unlocks are expressed as a lifetime spin
 * count, which is the hook a casino-host feature would drive later.
 */
export interface MachineDef {
  readonly id: string
  readonly name: string
  readonly tagline: string
  /** CSS colour used for its marquee glow and its row in the machine list. */
  readonly accent: string
  /** Lifetime spins needed before it can be played. Zero means always open. */
  readonly unlockAtSpins: number
  /** Null until the machine is actually built. */
  readonly config: GameConfig | null
}

export const MACHINES: readonly MachineDef[] = [
  {
    id: 'oxblood',
    name: 'Oxblood',
    tagline: 'Five reels, ten lines, your own clips',
    accent: '#C89B3F',
    unlockAtSpins: 0,
    config: CONFIG,
  },
  {
    id: 'jade-parlour',
    name: 'Jade Parlour',
    tagline: 'Twenty lines, and scatters that hold',
    accent: '#3FA88C',
    unlockAtSpins: 5_000,
    config: null,
  },
  {
    id: 'ember-room',
    name: 'Ember Room',
    tagline: 'Six reels, and a jackpot that never resets',
    accent: '#E2483C',
    unlockAtSpins: 25_000,
    config: null,
  },
]

export const DEFAULT_MACHINE = MACHINES[0]!

export const machineById = (id: string): MachineDef => MACHINES.find((m) => m.id === id) ?? DEFAULT_MACHINE

/** Built and past its spin threshold. */
export const isPlayable = (machine: MachineDef, lifetimeSpins: number): boolean =>
  machine.config !== null && lifetimeSpins >= machine.unlockAtSpins

/** Built, but not yet earned. */
export const isLocked = (machine: MachineDef, lifetimeSpins: number): boolean =>
  machine.config !== null && lifetimeSpins < machine.unlockAtSpins
