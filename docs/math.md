# Game math

Everything here is verified by two independent routes that agree: a closed-form
model in `src/game/analysis.ts`, and a Monte Carlo run over the actual engine in
`scripts/simulate.ts`. The simulator imports the same modules the game imports,
so what is measured is what ships.

```bash
node scripts/check.ts                      # rule assertions
node scripts/simulate.ts --spins 10000000  # the full verification
node scripts/tune.ts                       # re-derive the strips from targets
node scripts/paytable.ts                   # re-derive the paytable
```

## Where it landed

Headline figures are pooled over **50 million spins** (ten seeds of five
million), because a single ten-million-spin run has a standard error of about
0.13 points on RTP — enough to report 94.0% when the truth is 93.8%.

| Measure | Target | Measured over 50M spins |
| --- | --- | --- |
| RTP | 92–95% | **94.04% ± 0.05** |
| Hit frequency | — | 40.59% (1 in 2.5 spins) |
| Mini | 1 in 22–28 | **1 in 25.3** |
| Minor | 1 in 150 | **1 in 153.5** |
| Major | 1 in 800 | **1 in 787.3** |
| Longest Mini drought | — | 44 spins (hard bound) |
| Spins from 1000 credits | — | mean 1663, median 737 |

Per-seed RTP ranged 93.75% to 94.27%, which is the natural spread: a single
Major is 1000 credits and they arrive once in 787 spins, so RTP converges
slowly. Do not read a few thousand spins on the stats screen as a verdict.

RTP by source, against the brief's plan:

| Source | Planned | Measured |
| --- | --- | --- |
| Lines | ~48% | 48.66% |
| Mini | ~20% | 19.80% |
| Minor | ~13% | 13.01% |
| Major | ~13% | 12.57% |

## Three things the brief's numbers could not do

### 1. The paytable was about six times too thin

The brief's table (L 0.5/2/10, M 1/5/25, WILD 2/10/200 per bet-per-line)
returns **7.7% RTP**, not the ~48% the plan assigns to line wins. Bet is 10 with
1 per line, so five L1 paying 10 is one times the total bet for a 1-in-1200
event. The gap is not close enough to tune away with reel weights: matching a
symbol already happens on about 24% of reels, and there is no headroom to raise
that without erasing the low/medium distinction.

The shape of the table is fine, so it is kept and scaled by 6.32, then rounded
to whole numbers — the credit meter ticks in whole credits, and fractional pays
would be visible.

| Symbol | 3 | 4 | 5 |
| --- | --- | --- | --- |
| L1–L4 | 3 | 12 | 70 |
| M1–M2 | 6 | 30 | 170 |
| WILD | 15 | 70 | 1250 |

The medium five-of-a-kind is 170 rather than the 160 the first pass chose: the
paytable search worked from the closed-form line return, and the engine comes
in about 0.07 points under that. The gap is real and expected — the cooldown and
the pity timer both re-roll spins, which conditions the symbol distribution on
those spins and slightly changes what the lines pay. Ten extra credits on a
1-in-3400 event closes it.

### 2. One scatter per reel makes the tiers geometrically impossible

If a reel can show at most one scatter, the three tier frequencies cannot all be
hit — not approximately, but provably. Writing `r_i = q_i / p_i` for each reel:

```
P5 = ∏ p_i                     = 1/800
P4 = P5 · Σ r_i                = 1/150   →  Σ r_i    = 5.33
P3 = P5 · Σ_{i<j} r_i r_j      = 1/25    →  Σ r_i r_j = 32.0
```

But `(Σ r)² = Σ r² + 2 Σ_{i<j} r_i r_j`, which gives `Σ r² = 28.4 − 64 = −35.6`.
A sum of squares cannot be negative, so no set of per-reel scatter rates exists.
Intuitively: a 32:1 ratio between three scatters and five demands a far higher
per-reel scatter rate than a 1-in-25 Mini permits.

The fix is to let scatters clump. Each strip places its scatters as **singles**
or as **adjacent pairs**, with at least two filler positions between every
group. That spacing guarantees a three-row window can never straddle two
groups, which keeps the maths exact:

- a single is inside 3 of the N windows, always alone
- a pair is inside 4 windows — showing two scatters in 2 of them, one in the other 2

Pairs fatten the tail exactly where it was needed, and because they stay rare
the common case is untouched: a Mini still almost always arrives as three
scatters on three different reels.

Final placement: reels 1–3 carry 10 scatters with 3 of them as pairs; reels 4–5
carry 8 with 1 as a pair.

### 3. The cooldown costs more than it looks

The cooldown blocks any bonus for 4 spins after one lands. Bonuses land about 1
spin in 21 overall, so **18.9% of all spins are inside a cooldown** — every tier
is suppressed by roughly that much. The pity timer refills Mini but does nothing
for Minor or Major, so those two have to be tuned about 20% richer than their
targets before the cooldown takes its cut.

The tuner in `scripts/tune.ts` handles this by measuring, correcting its aim
from what the simulation reports, and re-searching. It converges in three passes.

## Reel strips

Counts are positions on a 200-position strip. Two hundred rather than a hundred
because the tiers need finer than 1% granularity to land on target — halve these
to read them as the percentages in the brief.

| Reel | L1 | L2 | L3 | L4 | M1 | M2 | WILD | SCATTER | pairs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 35 | 35 | 32 | 32 | 24 | 20 | 12 | 10 | 3 |
| 2 | 35 | 35 | 32 | 32 | 24 | 20 | 12 | 10 | 3 |
| 3 | 35 | 35 | 32 | 32 | 24 | 20 | 12 | 10 | 3 |
| 4 | 39 | 35 | 35 | 31 | 24 | 20 | 8 | 8 | 1 |
| 5 | 39 | 39 | 35 | 31 | 24 | 16 | 8 | 8 | 1 |

As percentages, against the brief's starting weights:

| Reel | change |
| --- | --- |
| 1–3 | scatter 4% → 5%, L3/L4 16% → 16%, everything else within half a point |
| 4 | scatter 2% → 4%, WILD 4% → 4%, L1 20% → 19.5% |
| 5 | scatter 2% → 4%, WILD 4% → 4%, L1 20% → 19.5% |

The non-scatter symbols keep the brief's proportions exactly; they were only
rescaled to make room for the extra scatters. Scatter weight went **up**, not
down, because the brief's rates produced a raw Mini of 1 in 147 — the pity timer
was carrying almost the whole feature.

## The two rules that bend the odds

Both are implemented by re-rolling the whole spin rather than nudging individual
reels, so every screen stays a genuine draw from the strips. A forced Mini is
indistinguishable from a natural one because it *is* a natural one, selected for.

- **Cooldown** (4 spins). Absolute, and it outranks the pity timer — two clips
  back to back cheapens both. If pity is owed during a cooldown it simply fires
  on the next eligible spin.
- **Pity** (40 spins). Forces exactly a Mini. It supplies **28.9% of all Minis**,
  which is the cost of guaranteeing the drought never runs long.

Because cooldown outranks pity, the worst possible Mini drought is
`pitySpins + cooldownSpins = 44` spins. The 10M-spin run observed exactly 44,
confirming the bound is reached and never exceeded.

## Anticipation

The reel-3 slowdown fires when reels 1 and 2 have both landed a scatter, which
happens **1 spin in 69**. This is why the search is constrained to keep reels
1–3 scatter-rich even though the tail maths would prefer the opposite: an
unconstrained search puts the scatters on reels 4 and 5, where they improve the
Major rate but make the anticipation almost never fire.

Note for phase 7: because a reel can now show two scatters, the trigger should
be "two or more scatters landed so far", not "reels 1 and 2 each have one".

## Turning one number

Everything above is driven by `CONFIG` in `src/game/config.ts`. Change
`pitySpins`, `cooldownSpins`, a tier pay, or any reel weight, then re-run
`node scripts/simulate.ts` to see what it did. If you move the scatter weights,
re-run `node scripts/paytable.ts` to rebalance the line pays against the new
bonus return.

## Sensitivity

Credits per spin added by raising one paytable cell by one credit — useful if
you want to move RTP without re-running the search:

| Symbol | 3 of a kind | 4 of a kind | 5 of a kind |
| --- | --- | --- | --- |
| L1–L4 | 0.3637 | 0.0779 | 0.0227 |
| M1–M2 | 0.0805 | 0.0127 | 0.0022 |
| WILD | 0.0013 | 0.0001 | ~0 |

One credit on the low three-of-a-kind is worth 3.6 points of RTP. That cell is
the coarsest control in the game and there is no whole number between 3 and 4,
which is why the medium and top pays carry the fine tuning.
