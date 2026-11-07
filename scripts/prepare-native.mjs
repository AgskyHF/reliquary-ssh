#!/usr/bin/env node
/**
 * Prepares the native modules for the packaging build.
 *
 * The optional dependency `cpu-features` (pulled in by ssh2) generates its
 * `buildcheck.gypi` in an install script. electron-builder runs
 * @electron/rebuild, which calls node-gyp directly — and node-gyp fails
 * with "buildcheck.gypi not found" when the file was never generated.
 *
 * This script generates the file when it is missing, so a clean install
 * packages without a manual step inside node_modules.
 *
 * Run: node scripts/prepare-native.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The modules that need a generated gyp file before the rebuild. */
const TARGETS = ['cpu-features']

function prepare(name) {
  const moduleDir = join(root, 'node_modules', name)
  if (!existsSync(moduleDir)) {
    console.log(`[prepare-native] ${name} is not installed — skipped`)
    return
  }

  const target = join(moduleDir, 'buildcheck.gypi')
  if (existsSync(target)) {
    console.log(`[prepare-native] ${name}: buildcheck.gypi is already there`)
    return
  }

  const script = join(moduleDir, 'buildcheck.js')
  if (!existsSync(script)) {
    console.log(`[prepare-native] ${name}: no buildcheck.js — skipped`)
    return
  }

  const output = execFileSync(process.execPath, [script], { cwd: moduleDir, encoding: 'utf8' })
  writeFileSync(target, output)
  console.log(`[prepare-native] ${name}: buildcheck.gypi generated`)
}

for (const target of TARGETS) {
  prepare(target)
}
