#!/usr/bin/env node
/**
 * Renders the application icon from build/assets/logo.svg.
 *
 * The SVG is the source of truth for the icon; this script rasterizes it
 * with Electron (Chromium), so no image tooling has to be installed on the
 * build machine — the same trick the old make-icon.py used, only with a
 * vector source instead of hand-written pixel math.
 *
 * Run: node scripts/make-icon.mjs
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SVG = join(ROOT, 'build', 'assets', 'logo.svg')
const OUT = join(ROOT, 'build')
const ICONSET = join(OUT, 'icon.iconset')
const PNG = join(OUT, 'icon.png')
const ICNS = join(OUT, 'icon.icns')
const BASE = 1024

/** The sizes an .iconset needs. */
const ICON_SIZES = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
]

app.whenReady().then(async () => {
  mkdirSync(ICONSET, { recursive: true })

  const svg = readFileSync(SVG, 'utf8')
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <style>
      html,body{margin:0;padding:0;background:transparent;width:100%;height:100%;overflow:hidden}
      svg{display:block;width:100%;height:100%}
    </style></head><body>${svg}</body></html>`

  const tmp = join(app.getPath('temp'), 'reliquary-icon.html')
  writeFileSync(tmp, html)

  // One window, one page: the window is resized for every icon size and
  // the SVG scales to fill it.
  const win = new BrowserWindow({
    width: BASE,
    height: BASE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })

  await win.loadFile(tmp)
  await new Promise((r) => setTimeout(r, 500))

  for (const [size, name] of ICON_SIZES) {
    win.setContentSize(size, size)
    await new Promise((r) => setTimeout(r, 250))
    const png = await win.webContents.capturePage()
    writeFileSync(join(ICONSET, name), png.toPNG())
    process.stdout.write(`  ${name} (${size}x${size})\n`)
  }

  win.destroy()

  // The 1024 PNG is the icon of the project itself.
  writeFileSync(PNG, readFileSync(join(ICONSET, 'icon_512x512@2x.png')))

  execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', ICNS])
  rmSync(ICONSET, { recursive: true, force: true })
  process.stdout.write(`wrote ${PNG}\nwrote ${ICNS}\n`)

  app.quit()
})
