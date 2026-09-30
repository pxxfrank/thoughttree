#!/usr/bin/env node
/**
 * The app version in one command, and a guard that it never drifts again.
 *
 * The version has to appear in four files, and they are read by four different
 * things: `package.json` by npm and by the UI (Vite injects it), `Cargo.toml`
 * and `Cargo.lock` by cargo, and `tauri.conf.json` by the bundler. Any one of
 * them left behind is a version that lies — the installer would report one
 * number while Settings showed another.
 *
 * `package.json` is the single source of truth. `tauri.conf.json` points at it
 * rather than repeating it, so the *shipped* version has exactly one home;
 * cargo cannot read a JSON file, so `Cargo.toml` is written from it and
 * `Cargo.lock` follows. `check` asserts all of that, and the build runs it, so
 * drift fails the build instead of shipping.
 *
 *   node scripts/version.mjs            show the current version and where it lives
 *   node scripts/version.mjs check      exit 1 if anything disagrees
 *   node scripts/version.mjs set 0.2.0  write 0.2.0 everywhere
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const PACKAGE_JSON = join(root, 'package.json')
const CARGO_TOML = join(root, 'src-tauri', 'Cargo.toml')
const CARGO_LOCK = join(root, 'src-tauri', 'Cargo.lock')
const TAURI_CONF = join(root, 'src-tauri', 'tauri.conf.json')

/** Where tauri.conf.json sends the bundler instead of holding its own copy. */
const CONF_POINTER = '../package.json'

const read = (path) => readFileSync(path, 'utf-8')

/** Writes text back with the line endings the file already used. */
function write(path, text) {
  const original = read(path)
  const normalised = original.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text
  writeFileSync(path, normalised, 'utf-8')
}

function packageVersion() {
  return JSON.parse(read(PACKAGE_JSON)).version
}

function cargoVersion() {
  const found = read(CARGO_TOML).match(/^version\s*=\s*"([^"]+)"/m)
  if (!found) throw new Error('no version line in Cargo.toml')
  return found[1]
}

function lockVersion() {
  const found = read(CARGO_LOCK).match(
    /\[\[package\]\]\s*\r?\nname = "thoughttree"\s*\r?\nversion = "([^"]+)"/,
  )
  if (!found) throw new Error('no thoughttree entry in Cargo.lock')
  return found[1]
}

function confVersion() {
  return JSON.parse(read(TAURI_CONF)).version
}

/** Every place a version is written, and what it currently says. */
function survey() {
  return [
    { file: 'package.json', value: packageVersion(), explains: 'npm, and the UI' },
    { file: 'src-tauri/Cargo.toml', value: cargoVersion(), explains: 'cargo' },
    { file: 'src-tauri/Cargo.lock', value: lockVersion(), explains: 'cargo' },
    { file: 'src-tauri/tauri.conf.json', value: confVersion(), explains: 'the bundler' },
  ]
}

function check() {
  const expected = packageVersion()
  const problems = []

  for (const entry of survey()) {
    if (entry.file.endsWith('tauri.conf.json')) {
      // This one must *point at* package.json, not repeat a number.
      if (entry.value !== CONF_POINTER) {
        problems.push(
          `${entry.file}: version is ${JSON.stringify(entry.value)}, expected the pointer ${JSON.stringify(CONF_POINTER)}`,
        )
      }
      continue
    }
    if (entry.value !== expected) {
      problems.push(`${entry.file}: ${entry.value}, expected ${expected}`)
    }
  }

  if (problems.length > 0) {
    console.error(`Version drift — package.json says ${expected}:`)
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('\nRun: node scripts/version.mjs set <version>')
    process.exit(1)
  }

  console.log(`Version ${expected} is consistent across all four files.`)
}

function set(next) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(next)) {
    console.error(`"${next}" is not a version. Expected something like 0.2.0 or 1.0.0-rc.1`)
    process.exit(1)
  }

  const pkgText = read(PACKAGE_JSON)
  const pkg = JSON.parse(pkgText)
  pkg.version = next
  write(PACKAGE_JSON, `${JSON.stringify(pkg, null, 2)}\n`)

  write(CARGO_TOML, read(CARGO_TOML).replace(/^version\s*=\s*"[^"]+"/m, `version = "${next}"`))

  // Cargo would rewrite this itself on the next build, but leaving it stale
  // makes the diff of a release bump noisy and confusing.
  write(
    CARGO_LOCK,
    read(CARGO_LOCK).replace(
      /(\[\[package\]\]\s*\r?\nname = "thoughttree"\s*\r?\nversion = ")[^"]+(")/,
      `$1${next}$2`,
    ),
  )

  console.log(`Set the version to ${next}.`)
  check()
}

function report() {
  const expected = packageVersion()
  console.log(`Current version: ${expected}\n`)
  for (const entry of survey()) {
    console.log(`  ${entry.value.padEnd(16)} ${entry.file}  (${entry.explains})`)
  }
  console.log('\n  set <version>   write a new version everywhere')
  console.log('  check           fail if any of them disagree')
}

const [command, argument] = process.argv.slice(2)
if (command === 'set') {
  if (!argument) {
    console.error('Usage: node scripts/version.mjs set <version>')
    process.exit(1)
  }
  set(argument)
} else if (command === 'check') {
  check()
} else if (command) {
  console.error(`Unknown command "${command}". Try: set <version>, check`)
  process.exit(1)
} else {
  report()
}
