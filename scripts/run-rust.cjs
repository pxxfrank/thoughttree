#!/usr/bin/env node
/**
 * Runs cargo / the Tauri CLI with a working MSVC environment.
 *
 * Why this exists: this machine's Visual Studio install has no
 * `VC/Tools/MSVC/<ver>/bin/Hostx64/x64/link.exe`, so a plain `cargo build` fails
 * with "linker `link.exe` not found". The x86-hosted x64 toolset
 * (`bin/Hostx86/x64`) produces identical x64 output, so after `vcvars64.bat` has
 * populated INCLUDE/LIB we simply put that toolset first on PATH.
 *
 * A temporary .cmd wrapper is used instead of passing the command through
 * `cmd /c "..."`, which mangles nested quotes on paths containing spaces.
 *
 * Usage: node scripts/run-rust.cjs <check|cargo|test|dev|build> [args...]
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const EDITIONS = ['BuildTools', 'Community', 'Professional', 'Enterprise', 'Preview']
const ROOT = path.resolve(__dirname, '..')

function findVcvars() {
  const roots = [process.env['ProgramFiles(x86)'], process.env['ProgramFiles']].filter(Boolean)
  for (const root of roots) {
    const vsDir = path.join(root, 'Microsoft Visual Studio')
    if (!fs.existsSync(vsDir)) continue
    for (const version of fs.readdirSync(vsDir)) {
      for (const edition of EDITIONS) {
        const candidate = path.join(vsDir, version, edition, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }
  return null
}

/** Directories holding an x64-targeting link.exe, in preference order. */
function findX64ToolsetBins(vcvars) {
  const msvcRoot = path.resolve(path.dirname(vcvars), '..', '..', 'Tools', 'MSVC')
  if (!fs.existsSync(msvcRoot)) return []
  const bins = []
  for (const version of fs.readdirSync(msvcRoot)) {
    for (const host of ['Hostx64/x64', 'Hostx86/x64']) {
      const bin = path.join(msvcRoot, version, 'bin', ...host.split('/'))
      if (fs.existsSync(path.join(bin, 'link.exe'))) bins.push(bin)
    }
  }
  return bins
}

/**
 * tauri-winres needs a resource compiler. This SDK layout has the x64 rc.exe
 * missing, but rc.exe only turns .rc into .res (no code generation), so the
 * 32-bit one from the same SDK version is fine.
 */
function findSdkBin() {
  const sdkBin = path.join(process.env['ProgramFiles(x86)'] ?? '', 'Windows Kits', '10', 'bin')
  if (!fs.existsSync(sdkBin)) return []
  const dirs = []
  const versions = fs
    .readdirSync(sdkBin)
    .filter((name) => /^\d+\.\d+/.test(name))
    .sort()
    .reverse()
  for (const version of versions) {
    for (const arch of ['x64', 'x86']) {
      const dir = path.join(sdkBin, version, arch)
      if (fs.existsSync(path.join(dir, 'rc.exe'))) dirs.push(dir)
    }
  }
  return dirs
}

function resolveCommand(mode, rest) {
  switch (mode) {
    case 'check':
    case 'test':
      return { line: [mode === 'test' ? 'cargo test' : 'cargo check', ...rest].join(' '), cwd: path.join(ROOT, 'src-tauri') }
    case 'cargo':
      return { line: ['cargo', ...rest].join(' '), cwd: path.join(ROOT, 'src-tauri') }
    case 'dev':
      return { line: ['pnpm exec tauri dev', ...rest].join(' '), cwd: ROOT }
    case 'build':
      return { line: ['pnpm exec tauri build', ...rest].join(' '), cwd: ROOT }
    default:
      console.error('usage: node scripts/run-rust.cjs <check|cargo|test|dev|build> [args...]')
      process.exit(1)
  }
}

function main() {
  const [mode, ...rest] = process.argv.slice(2)
  const { line, cwd } = resolveCommand(mode, rest)

  if (process.platform !== 'win32' || process.env.THOUGHTTREE_SKIP_MSVC === '1') {
    process.exit(spawnSync(line, { stdio: 'inherit', shell: true, cwd }).status ?? 1)
  }

  const vcvars = findVcvars()
  if (!vcvars) {
    console.warn('[run-rust] vcvars64.bat not found; using the current environment')
    process.exit(spawnSync(line, { stdio: 'inherit', shell: true, cwd }).status ?? 1)
  }

  const bins = [...findX64ToolsetBins(vcvars), ...findSdkBin()]
  const script = [
    '@echo off',
    `call "${vcvars}" >nul 2>&1`,
    bins.length > 0 ? `set "PATH=${bins.join(';')};%PATH%"` : '',
    line,
  ]
    .filter(Boolean)
    .join('\r\n')

  if (process.env.THOUGHTTREE_DEBUG === '1') {
    console.log('[run-rust] vcvars:', vcvars)
    console.log('[run-rust] extra PATH entries:', bins)
    console.log('[run-rust] command:', line)
  }

  const wrapper = path.join(os.tmpdir(), `thoughttree-rust-${process.pid}.cmd`)
  fs.writeFileSync(wrapper, `${script}\r\n`, 'utf8')
  try {
    const result = spawnSync('cmd.exe', ['/d', '/c', wrapper], {
      stdio: 'inherit',
      cwd,
      windowsHide: false,
    })
    process.exit(result.status ?? 1)
  } finally {
    fs.rmSync(wrapper, { force: true })
  }
}

main()
