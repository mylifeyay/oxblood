# Oxblood

A five-reel slot machine that runs as an installable web app on an iPhone.
Single player, local only, no real money anywhere. Bonus wins pay credits and
play a random ten-second slice of a video you imported from your camera roll.

Everything runs client side. There is no server, no database, no account, no
analytics, and no network call after the first load.

## Running it

```bash
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server over plain HTTP, reachable on the LAN |
| `npm run dev:https` | Dev server over a self-signed certificate |
| `npm run build` | Type-checks, then builds to `dist/` |
| `npm run preview` | Serves the built `dist/` over HTTP |
| `npm run preview:https` | Builds, then serves `dist/` over a self-signed certificate |
| `npm run icons` | Regenerates every launcher icon from `scripts/make-icons.mjs` |
| `npm run check` | Rule assertions over the payout engine |
| `npm run simulate` | Ten million spins, with the full maths report |
| `npm run tune` | Re-derives the reel strips from the frequency targets |
| `npm run paytable` | Re-derives the line paytable from the target RTP |
| `npm run build:pages` | Builds with a `/repo/` base path, as Pages serves it |

## Testing on the phone

Service workers and Add to Home Screen both need a secure context, so plain
HTTP on the LAN will not do for the offline half of the test.

1. Run `npm run preview:https` and note the network address it prints.
2. Open that address in Safari on the phone, on the same Wi-Fi.
3. Safari will warn about the certificate. Tap **Show details**, then
   **visit this website**, then confirm.
4. Wait for the line at the bottom of the machine to read **Ready to play
   offline**.
5. Tap share, then **Add to Home Screen**.
6. Launch it from the home screen. It should open with no browser chrome, the
   status bar sitting over the cabinet, and nothing hidden behind the notch or
   the home indicator.
7. Put the phone in airplane mode and launch it again. It should still open.

## Layout

```
index.html              cabinet markup
scripts/make-icons.mjs  vector source for every launcher icon
src/audio/              synthesised sound, one AudioContext
src/game/               payout engine, config, reel strips, ledger, video storage
src/ui/                 reel display, meters, menu, stats, video library, juice
src/main.ts             entry point
src/pwa.ts              service worker registration and status reporting
src/fonts/              Anton, Archivo and DSEG7 Classic, vendored as woff2
src/styles/             hand-written CSS, one file per region
public/icons/           generated PNGs, checked in
vite.config.ts          build config, manifest and precache rules
```

## Deploying

Pushing to `main` builds and publishes to GitHub Pages. The workflow is in
`.github/workflows/deploy.yml`; it type-checks, runs the payout assertions, and
only then builds — a change that breaks the maths never reaches the phone.

GitHub Pages serves a project site from `/<repo>/`, so the base path is baked in
at build time from the repository name. Nothing needs editing when you rename
the repo.

One-time setup on GitHub: **Settings → Pages → Build and deployment → Source:
GitHub Actions**.

To build a subpath copy locally:

```bash
VITE_BASE=/your-repo-name/ npm run build
```

## Machines

Three cabinets, all returning about 94%, all rewarding the same three bonus
tiers with a clip from your library.

| | Board | Scoring | Bet | Hit rate |
| --- | --- | --- | --- | --- |
| Oxblood | 5 × 3 | 10 fixed lines | 10 | 40.6% |
| Jade Parlour | 5 × 3 | 243 ways | 25 | 57.4% |
| Ember Room | 6 × 4 | 4096 ways + progressive | 50 | 61.8% |

Ember takes 2% of every wager into a pot that pays out whole when six scatters
land — which is also a Major, so the biggest hit on the machine pays the tier,
plays a Legendary clip and empties the pot at once. The pot persists and only
restarts when somebody wins it.

A machine carries its own payout config and board size (`src/game/`), skin,
palette, sound and reel timings (`src/ui/skins.ts`, `src/styles/themes.css`).
Unlocks are driven by lifetime wagered or lifetime spins — the thresholds are
deliberately not shown in the interface.

## Things worth knowing

- **Stats are hidden.** Tap the marquee three times to open them. Stats is also
  the only screen that explains how the game is designed — everywhere else was
  stripped of mechanics prose.
- **Tap the bet meter** to cycle 10 / 20 / 50 / 100 / 250 a spin. Bonus tiers pay
  a multiple of the bet, so the return is identical at every level.
- Bonus clip length is per tier: 10 seconds for a Mini, 15 for a Minor, 30 for a
  Major.
- **A win unlocks only what it showed.** Videos are divided into 10-second
  segments; a bonus reveals the ones its slice crossed. The unlocked gallery
  plays back the parts you have won and skips the rest, so the whole video only
  opens up once you have won across all of it.

## Build phases

- [x] **1 — Shell.** Vite scaffold, manifest, service worker, icons, safe
      areas, offline precache. Nothing plays yet.
- [x] **2 — Math.** Payout engine, pity timer, cooldown, Monte Carlo
      verification. 94.00% RTP. See [docs/math.md](docs/math.md).
- [x] **3 — Reels.** Spin with real math, credits, payline evaluation and
      win display. Placeholder symbols, no sound, no juice.
- [x] **4 — Ledger.** Append-only ledger in IndexedDB, derived balance and
      net, add credit, stats screen with live observed RTP.
- [x] **5 — Library.** Import with validation, duplicate detection, poster
      capture, tiers, multi-select, delete, storage reporting.
- [x] **6 — Bonus.** Tier and clip selection, random offset, seek-then-reveal
      sequencing, iris wipe, counter, source card.
- [x] **7 — Juice.** Synthesised audio, three-phase reel spin, anticipation,
      win tiers, particles, rolling LED meter.
- [x] **8 — Ship.** Offline verified at a subpath, GitHub Pages workflow.

## Fonts

Anton, Archivo and DSEG7 Classic are all SIL Open Font License 1.1 and are
bundled as local woff2 files. See `src/fonts/LICENSES.txt`.
