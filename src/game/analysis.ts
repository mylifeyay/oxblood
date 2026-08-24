import { SCATTER } from './symbols.ts'

import { tierPay, type GameConfig } from './config.ts'

/**
 * Closed-form scatter maths. The strip builder spaces scatter groups so that a
 * window never straddles two of them, which makes the per-reel distribution
 * exact rather than estimated. For a window `r` rows deep:
 *
 *   a single scatter is inside r of the N windows, always alone
 *   an adjacent pair is inside r + 1 windows — r - 1 showing both, 2 showing one
 *
 * The `r - 1` matters: on a four-row board a pair shows as two scatters in
 * three windows, not two, and assuming otherwise understates every rate above
 * three scatters.
 *
 * Having this in closed form is what makes tuning tractable: the search runs in
 * microseconds and the Monte Carlo only has to confirm it.
 */
export function reelScatterDistribution(config: GameConfig, reel: number): [number, number, number] {
  const spec = config.reels[reel]!
  const total = spec.weights.reduce((a, b) => a + b, 0)
  const scatters = spec.weights[SCATTER] ?? 0
  const pairs = spec.scatterPairs
  const singles = scatters - pairs * 2
  const rows = config.rows

  const two = ((rows - 1) * pairs) / total
  const one = (rows * singles + 2 * pairs) / total
  return [1 - one - two, one, two]
}

/** Distribution of the total scatter count across all five reels. */
export function scatterCountDistribution(config: GameConfig): number[] {
  let dist = [1]
  for (let reel = 0; reel < config.reels.length; reel++) {
    const per = reelScatterDistribution(config, reel)
    const next = new Array<number>(dist.length + 2).fill(0)
    for (let i = 0; i < dist.length; i++) {
      for (let k = 0; k < 3; k++) next[i + k]! += dist[i]! * per[k]!
    }
    dist = next
  }
  return dist
}

/** Raw per-spin probability of each tier, before the pity timer and cooldown. */
export function rawTierProbabilities(config: GameConfig): Map<string, number> {
  const dist = scatterCountDistribution(config)
  const out = new Map<string, number>()
  for (const tier of config.tiers) out.set(tier.name, 0)

  for (let count = 0; count < dist.length; count++) {
    let hit: string | null = null
    for (const tier of config.tiers) if (count >= tier.scatters) hit = tier.name
    if (hit) out.set(hit, out.get(hit)! + dist[count]!)
  }
  return out
}

/**
 * Exact expected line return per spin, in credits.
 *
 * Every payline reads one cell from each reel, so each line sees that reel's
 * marginal symbol distribution regardless of how the strip is ordered. Lines
 * are correlated with each other, but expectation is linear, so the total is
 * simply the line count times the per-line expectation.
 */
export function expectedLineReturn(config: GameConfig): number {
  const marginals = config.reels.map((spec) => {
    const total = spec.weights.reduce((a, b) => a + b, 0)
    return spec.weights.map((w) => w / total)
  })

  const wildAt = (reel: number): number => marginals[reel]![6]!
  const symbolAt = (reel: number, symbol: number): number => marginals[reel]![symbol]!

  let perLine = 0

  // Runs that are pure WILD from reel 1.
  for (let run = 3; run <= 5; run++) {
    let p = 1
    for (let reel = 0; reel < run; reel++) p *= wildAt(reel)
    if (run < 5) p *= 1 - wildAt(run)
    perLine += p * config.paytable[6]![run - 3]!
  }

  // Runs led by a paying symbol, with WILDs substituting inside the run.
  for (let symbol = 0; symbol <= 5; symbol++) {
    for (let lead = 0; lead < 5; lead++) {
      // `lead` WILDs, then the symbol itself, then more matches.
      for (let run = Math.max(3, lead + 1); run <= 5; run++) {
        let p = 1
        for (let reel = 0; reel < lead; reel++) p *= wildAt(reel)
        p *= symbolAt(lead, symbol)
        for (let reel = lead + 1; reel < run; reel++) p *= symbolAt(reel, symbol) + wildAt(reel)
        if (run < 5) p *= 1 - symbolAt(run, symbol) - wildAt(run)
        if (p === 0) continue

        // The line pays the better of this reading and the pure-WILD reading,
        // which only overlap when the leading WILDs already pay on their own.
        const symbolPay = config.paytable[symbol]![run - 3]!
        const wildPay = lead >= 3 ? config.paytable[6]![lead - 3]! : 0
        perLine += p * Math.max(0, symbolPay - wildPay)
      }
    }
  }

  return perLine * config.lineCount * config.betPerLine
}

/** Exact expected bonus return per spin, in credits, before pity and cooldown. */
export function expectedBonusReturn(config: GameConfig): number {
  const probs = rawTierProbabilities(config)
  let total = 0
  for (const tier of config.tiers) total += (probs.get(tier.name) ?? 0) * tierPay(tier, config.totalBet)
  return total
}
