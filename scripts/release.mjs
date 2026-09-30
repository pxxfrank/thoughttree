#!/usr/bin/env node
/**
 * Publishes a release: builds the Windows installer and attaches it to a GitHub
 * release tagged `v<version>`.
 *
 * The point is that the artifact on the Releases page is the one this source
 * tree builds — so the script refuses to run from a dirty tree, checks the
 * version files agree, builds, and only then tags and uploads.
 *
 * A release is keyed to the version, so publishing twice under one version is
 * refused: bump first. That is deliberate. Quietly replacing a binary that
 * people have already downloaded, under a version number that has not moved, is
 * worse than an error message.
 *
 *   pnpm app:release                build and publish the current version
 *   pnpm app:release --skip-build   publish an installer that is already built
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe = process.platform === 'win32' ? '.exe' : ''

const run = (command, args) =>
  execFileSync(command + exe, args, { cwd: root, stdio: 'inherit' })

const capture = (command, args) =>
  execFileSync(command + exe, args, { cwd: root, encoding: 'utf-8' }).trim()

function fail(message) {
  console.error(`\n${message}`)
  process.exit(1)
}

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version
const tag = `v${version}`
const skipBuild = process.argv.includes('--skip-build')

console.log(`Releasing ${tag}\n`)

// 1. Release only what has been committed. An installer built from uncommitted
//    edits is a binary nobody can reproduce from the tag it points at.
const dirty = capture('git', ['status', '--porcelain'])
if (dirty) {
  fail(`Working tree is dirty — commit first:\n${dirty}`)
}

// 2. The tag must point at a commit the remote has, or the release links nowhere.
const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
const ahead = capture('git', ['rev-list', '--count', `origin/${branch}..${branch}`])
if (ahead !== '0') {
  fail(`${ahead} commit(s) on ${branch} are not pushed. Run: git push`)
}

// 3. Every file that declares a version must agree with package.json.
run('node', ['scripts/version.mjs', 'check'])

// 4. The installer must be the product of this tree.
if (skipBuild) {
  console.log('\nSkipping the build -- reusing whatever is in target/release.')
} else {
  console.log('\nBuilding...')
  run('node', ['scripts/run-rust.cjs', 'build'])
}

const bundleDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const candidates = readdirSync(bundleDir).filter((name) => /setup\.exe$/i.test(name))

// Pick by version rather than by position. Older builds are left behind in this
// directory, so "the first one" is the *oldest* one — which is how a 0.1.0
// installer nearly got published under 0.1.1.
const name = candidates.find((candidate) => candidate.includes(version))

if (!name) {
  fail(
    `No installer for ${version} in ${bundleDir}.\n` +
      `Found: ${candidates.join(', ') || '(nothing)'}`,
  )
}

const installer = join(bundleDir, name)

const bytes = readFileSync(installer)
const digest = createHash('sha256').update(bytes).digest('hex')
const checksumFile = `${installer}.sha256`
writeFileSync(checksumFile, `${digest}  ${installer.split('\\').pop()}\n`, 'utf-8')

console.log(`\nInstaller: ${installer.split('\\').pop()}`)
console.log(`sha256:    ${digest}`)

// 5. Tag the commit the release will point at.
const existingTag = capture('git', ['tag', '-l', tag])
if (!existingTag) {
  run('git', ['tag', '-a', tag, '-m', `ThoughtTree ${tag}`])
}
run('git', ['push', 'origin', tag])

// 6. Publish. A release is keyed to its version, so an existing one means the
//    version should have moved.
try {
  capture('gh', ['release', 'view', tag])
  fail(
    `A release for ${tag} already exists.\n` +
      `Bump the version (pnpm version:set x.y.z), commit, then release again.\n` +
      `To deliberately replace the asset instead: gh release upload ${tag} "${installer}" --clobber`,
  )
} catch (error) {
  // `gh release view` exits non-zero when the release does not exist — the
  // expected path. A real failure would have thrown something else by now.
  if (error.status === undefined) throw error
}

const notes = [
  '## Install',
  '',
  `Download \`${installer.split('\\').pop()}\` and run it. It installs for the`,
  'current user, needs no admin rights, and keeps your existing data.',
  '',
  `SHA-256: \`${digest}\``,
  '',
  '---',
].join('\n')

run('gh', [
  'release',
  'create',
  tag,
  installer,
  checksumFile,
  '--title',
  `ThoughtTree ${tag}`,
  '--notes',
  notes,
  '--generate-notes',
  '--latest',
])

console.log(`\nPublished: https://github.com/pxxfrank/thoughttree/releases/tag/${tag}`)
