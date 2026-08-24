import { L1, L2, L3, L4, M1, M2, WILD, SCATTER } from '../game/symbols.ts'
import type { SymbolFace } from './symbols.ts'

/** Reel timings. A cabinet's hands feel different from the next one's. */
export interface MotionProfile {
  /** Strip positions per millisecond at full speed. */
  spinSpeed: number
  baseSpinMs: number
  staggerMs: number
  stopMs: number
  settleMs: number
  overshootPx: number
  liftPx: number
  anticipationMs: number
}

/** Synth settings. Same engine, different instrument. */
export interface SoundProfile {
  clackHz: number
  clackDecay: number
  thumpHz: number
  tickBase: number
  tickSpread: number
  chime: OscillatorType
  smallRun: number[]
  mediumRun: number[]
  bigRun: number[]
  bonusRuns: Record<'mini' | 'minor' | 'major', { notes: number[]; type: OscillatorType; length: number }>
  riserFrom: number
  riserTo: number
  riserType: OscillatorType
}

export interface Skin {
  faces: readonly SymbolFace[]
  motion: MotionProfile
  sound: SoundProfile
}

const face = (glyph: string, kind: SymbolFace['kind'], label: string): SymbolFace => ({ glyph, kind, label })

const oxbloodFaces: SymbolFace[] = []
oxbloodFaces[L1] = face('♠', 'low', 'spade')
oxbloodFaces[L2] = face('♥', 'low', 'heart')
oxbloodFaces[L3] = face('♦', 'low', 'diamond')
oxbloodFaces[L4] = face('♣', 'low', 'club')
oxbloodFaces[M1] = face('★', 'medium', 'star')
oxbloodFaces[M2] = face('⬢', 'medium', 'hexagon')
oxbloodFaces[WILD] = face('W', 'wild', 'wild')
oxbloodFaces[SCATTER] = face('✦', 'scatter', 'scatter')

const jadeFaces: SymbolFace[] = []
jadeFaces[L1] = face('●', 'low', 'coin')
jadeFaces[L2] = face('◆', 'low', 'lozenge')
jadeFaces[L3] = face('▲', 'low', 'peak')
jadeFaces[L4] = face('■', 'low', 'tile')
jadeFaces[M1] = face('✿', 'medium', 'blossom')
jadeFaces[M2] = face('☾', 'medium', 'crescent')
jadeFaces[WILD] = face('❖', 'wild', 'wild')
jadeFaces[SCATTER] = face('✺', 'scatter', 'scatter')

const emberFaces: SymbolFace[] = []
emberFaces[L1] = face('◇', 'low', 'facet')
emberFaces[L2] = face('▽', 'low', 'wedge')
emberFaces[L3] = face('◻', 'low', 'plate')
emberFaces[L4] = face('◯', 'low', 'ring')
emberFaces[M1] = face('✹', 'medium', 'spark')
emberFaces[M2] = face('✷', 'medium', 'flare')
emberFaces[WILD] = face('✳', 'wild', 'wild')
emberFaces[SCATTER] = face('❂', 'scatter', 'scatter')

export const SKINS: Record<string, Skin> = {
  oxblood: {
    faces: oxbloodFaces,
    motion: {
      spinSpeed: 0.03,
      baseSpinMs: 700,
      staggerMs: 180,
      stopMs: 340,
      settleMs: 220,
      overshootPx: 8,
      liftPx: 12,
      anticipationMs: 1100,
    },
    sound: {
      clackHz: 1500,
      clackDecay: 0.055,
      thumpHz: 120,
      tickBase: 760,
      tickSpread: 900,
      chime: 'triangle',
      smallRun: [1046, 1318],
      mediumRun: [1046, 1318, 1568],
      bigRun: [784, 1046, 1318, 1568, 2093],
      bonusRuns: {
        mini: { notes: [523, 659, 784], type: 'square', length: 0.28 },
        minor: { notes: [659, 880, 1046, 1318], type: 'triangle', length: 0.36 },
        major: { notes: [261, 392, 523, 659, 784, 1046], type: 'triangle', length: 0.7 },
      },
      riserFrom: 190,
      riserTo: 920,
      riserType: 'sawtooth',
    },
  },

  // Heavier hands, softer voice. The reels take their time and the chimes are
  // bells rather than a fanfare.
  jade: {
    faces: jadeFaces,
    motion: {
      spinSpeed: 0.023,
      baseSpinMs: 900,
      staggerMs: 240,
      stopMs: 420,
      settleMs: 300,
      overshootPx: 13,
      liftPx: 16,
      anticipationMs: 1500,
    },
    sound: {
      clackHz: 780,
      clackDecay: 0.1,
      thumpHz: 78,
      tickBase: 620,
      tickSpread: 620,
      chime: 'sine',
      smallRun: [880, 1174],
      mediumRun: [880, 1174, 1396],
      bigRun: [587, 880, 1174, 1396, 1760],
      bonusRuns: {
        mini: { notes: [440, 587, 880], type: 'sine', length: 0.5 },
        minor: { notes: [587, 784, 1046, 1174], type: 'sine', length: 0.62 },
        major: { notes: [220, 330, 440, 587, 784, 1046], type: 'sine', length: 1.1 },
      },
      riserFrom: 150,
      riserTo: 760,
      riserType: 'triangle',
    },
  },

  // Quick and hard. Six reels stopping 130ms apart is a drum roll rather than
  // the measured tick of the other two, and the voice is brighter and harsher.
  ember: {
    faces: emberFaces,
    motion: {
      spinSpeed: 0.038,
      baseSpinMs: 620,
      staggerMs: 130,
      stopMs: 300,
      settleMs: 180,
      overshootPx: 10,
      liftPx: 10,
      anticipationMs: 1300,
    },
    sound: {
      clackHz: 1950,
      clackDecay: 0.04,
      thumpHz: 150,
      tickBase: 900,
      tickSpread: 1200,
      chime: 'square',
      smallRun: [1244, 1661],
      mediumRun: [1244, 1661, 1975],
      bigRun: [830, 1244, 1661, 1975, 2489],
      bonusRuns: {
        mini: { notes: [622, 831, 1046], type: 'square', length: 0.24 },
        minor: { notes: [740, 988, 1244, 1480], type: 'square', length: 0.3 },
        major: { notes: [311, 466, 622, 831, 1046, 1244], type: 'sawtooth', length: 0.6 },
      },
      riserFrom: 240,
      riserTo: 1300,
      riserType: 'sawtooth',
    },
  },
}

export const skinFor = (theme: string): Skin => SKINS[theme] ?? SKINS.oxblood!
