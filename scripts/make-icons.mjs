// Renders every launcher icon from one vector source, so the set never drifts.
// Run with: npm run icons
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/icons')

const CABINET = '#1A0E12'
const CABINET_LIFT = '#2A141A'
const FELT = '#2E1620'
const BRASS = '#C89B3F'
const AMBER = '#FFB443'
const WELL = '#150809'

/**
 * @param {number} inset fraction of the canvas kept clear at each edge.
 *   0.06 for normal icons, 0.20 for maskable (Android crops to a circle).
 */
function icon(inset) {
  const S = 512
  const pad = S * inset
  const box = S - pad * 2
  const frameStroke = box * 0.035
  const innerPad = box * 0.10
  const innerX = pad + innerPad
  const innerY = pad + innerPad
  const innerW = box - innerPad * 2
  const gap = innerW * 0.05
  const colW = (innerW - gap * 2) / 3
  const winY = innerY + innerW * 0.10
  const winH = innerW * 0.80
  const barH = winH * 0.20
  const barY = winY + (winH - barH) / 2

  const windows = [0, 1, 2]
    .map((i) => {
      const x = innerX + i * (colW + gap)
      return `
      <rect x="${x}" y="${winY}" width="${colW}" height="${winH}" rx="3" fill="${WELL}"/>
      <rect x="${x}" y="${winY}" width="${colW}" height="${winH}" rx="3" fill="url(#well)"/>
      <rect x="${x + colW * 0.14}" y="${barY}" width="${colW * 0.72}" height="${barH}" rx="2" fill="url(#lamp)"/>`
    })
    .join('')

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${CABINET_LIFT}"/>
      <stop offset="1" stop-color="${CABINET}"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.06" r="0.8">
      <stop offset="0" stop-color="${AMBER}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${AMBER}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E8C275"/>
      <stop offset="0.5" stop-color="${BRASS}"/>
      <stop offset="1" stop-color="#8A6522"/>
    </linearGradient>
    <linearGradient id="well" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.07"/>
      <stop offset="0.55" stop-color="#000000" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.36"/>
    </linearGradient>
    <linearGradient id="lamp" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFD79A"/>
      <stop offset="0.45" stop-color="${AMBER}"/>
      <stop offset="1" stop-color="#D07E1C"/>
    </linearGradient>
  </defs>

  <rect width="${S}" height="${S}" fill="url(#body)"/>
  <rect width="${S}" height="${S}" fill="url(#halo)"/>
  <rect x="${pad + frameStroke / 2}" y="${pad + frameStroke / 2}"
        width="${box - frameStroke}" height="${box - frameStroke}" rx="6"
        fill="${FELT}" stroke="url(#frame)" stroke-width="${frameStroke}"/>
  ${windows}
</svg>`)
}

const targets = [
  { file: 'icon-192.png', size: 192, inset: 0.06 },
  { file: 'icon-512.png', size: 512, inset: 0.06 },
  { file: 'apple-touch-icon-180.png', size: 180, inset: 0.06 },
  { file: 'icon-maskable-512.png', size: 512, inset: 0.2 },
]

await mkdir(outDir, { recursive: true })

for (const { file, size, inset } of targets) {
  await sharp(icon(inset))
    .resize(size, size)
    // Home-screen icons must be opaque; iOS renders alpha as black anyway.
    .flatten({ background: CABINET })
    .png({ compressionLevel: 9 })
    .toFile(resolve(outDir, file))
  console.log(`wrote icons/${file} (${size}px)`)
}

// A vector favicon for desktop tabs during development.
await writeFile(resolve(root, 'public/favicon.svg'), icon(0.06))
console.log('wrote favicon.svg')
