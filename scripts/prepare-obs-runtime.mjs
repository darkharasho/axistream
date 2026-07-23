#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256File } from './obs-runtime-lib.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetRoot = join(repoRoot, 'resources', 'obs-runtime')
const manifest = JSON.parse(readFileSync(join(assetRoot, 'manifest.json'), 'utf8'))
const requested = process.argv.find((arg) => arg.startsWith('--platform='))?.split('=')[1] ??
  (process.platform === 'win32' ? 'windows' : process.platform)

async function downloadVerified(url, destination, expectedSha256) {
  mkdirSync(dirname(destination), { recursive: true })
  if (existsSync(destination) && await sha256File(destination) === expectedSha256) return
  const temporary = `${destination}.download`
  rmSync(temporary, { force: true })
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`)
  const output = createWriteStream(temporary, { flags: 'wx' })
  await new Promise((resolvePromise, reject) => {
    const reader = response.body.getReader()
    const pump = async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!output.write(value)) await new Promise((resume) => output.once('drain', resume))
        }
        output.end(resolvePromise)
      } catch (error) { output.destroy(); reject(error) }
    }
    void pump()
    output.on('error', reject)
  })
  const actual = await sha256File(temporary)
  if (actual !== expectedSha256) {
    rmSync(temporary, { force: true })
    throw new Error(`Hash mismatch for ${basename(destination)}: expected ${expectedSha256}, got ${actual}`)
  }
  renameSync(temporary, destination)
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' })
    let stdout = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolvePromise(stdout.trim()) : reject(new Error(`${command} exited ${code}`)))
  })
}

// Retry a command that pulls from the network — flatpak-builder fetches the
// manifest sources (CEF, obs-deps) up front and a transient reset (observed:
// "module cef: Send failure: Connection reset by peer") kills the whole build.
// flatpak-builder caches downloads + ccache outside the --force-clean build
// dir, so a retry resumes rather than rebuilding from scratch.
async function runWithRetry(command, args, options = {}, { tries = 3, delayMs = 15_000, label = command } = {}) {
  let lastErr
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await run(command, args, options)
    } catch (error) {
      lastErr = error
      if (attempt < tries) {
        console.warn(`[prepare-obs-runtime] ${label} failed (attempt ${attempt}/${tries}): ${error.message}. Retrying in ${delayMs / 1000}s...`)
        await new Promise((resume) => setTimeout(resume, delayMs))
      }
    }
  }
  throw lastErr
}

async function prepareWindows() {
  const cfg = manifest.windows
  await downloadVerified(cfg.archiveUrl, join(assetRoot, 'windows', cfg.archiveFile), cfg.archiveSha256)
  await downloadVerified(manifest.linux.sourceUrl, join(assetRoot, 'notices', 'obs-studio-32.1.2-source.tar.gz'), manifest.linux.sourceSha256)
}

async function prepareLinux() {
  if (process.arch !== 'x64') throw new Error('The pinned Linux OBS runtime currently supports x86_64 only')
  const cfg = manifest.linux
  await run('flatpak', ['install', '--user', '--noninteractive', '--or-update', 'flathub', cfg.runtime, cfg.sdk])
  const workRoot = join(repoRoot, '.cache', 'obs-flatpak-build')
  const buildDir = join(workRoot, 'build')
  const repo = join(workRoot, 'repo')
  mkdirSync(workRoot, { recursive: true })
  await runWithRetry('flatpak-builder', [
    '--user', '--force-clean', '--ccache', `--repo=${repo}`, buildDir,
    join(repoRoot, 'packaging', 'flatpak', 'link.axi.AxiStream.OBS.json'),
  ], {}, { label: 'flatpak-builder (OBS source download + build)' })
  const sourceRoot = join(workRoot, 'source')
  const sourceCheckout = join(sourceRoot, `obs-studio-${cfg.obsVersion}`)
  let checkoutCommit = ''
  if (existsSync(sourceCheckout)) {
    checkoutCommit = await run('git', ['-C', sourceCheckout, 'rev-parse', 'HEAD'], { capture: true })
  }
  if (checkoutCommit !== cfg.sourceCommit) {
    rmSync(sourceCheckout, { recursive: true, force: true })
    mkdirSync(dirname(sourceCheckout), { recursive: true })
    await run('git', [
      'clone', '--recursive', '--branch', cfg.obsVersion, '--single-branch',
      cfg.sourceGitUrl, sourceCheckout,
    ])
  }
  await run('git', ['-C', sourceCheckout, 'submodule', 'update', '--init', '--recursive'])
  checkoutCommit = await run('git', ['-C', sourceCheckout, 'rev-parse', 'HEAD'], { capture: true })
  if (checkoutCommit !== cfg.sourceCommit) throw new Error(`OBS source commit mismatch: ${checkoutCommit}`)
  for (const plugin of cfg.pluginSources) {
    const pluginCheckout = join(sourceRoot, plugin.name)
    let pluginCommit = ''
    if (existsSync(pluginCheckout)) {
      pluginCommit = await run('git', ['-C', pluginCheckout, 'rev-parse', 'HEAD'], { capture: true })
    }
    if (pluginCommit !== plugin.commit) {
      rmSync(pluginCheckout, { recursive: true, force: true })
      await run('git', ['clone', '--recursive', plugin.url, pluginCheckout])
      await run('git', ['-C', pluginCheckout, 'checkout', '--detach', plugin.commit])
    }
    await run('git', ['-C', pluginCheckout, 'submodule', 'update', '--init', '--recursive'])
    pluginCommit = await run('git', ['-C', pluginCheckout, 'rev-parse', 'HEAD'], { capture: true })
    if (pluginCommit !== plugin.commit) throw new Error(`${plugin.name} source commit mismatch: ${pluginCommit}`)
  }
  const noticesDir = join(assetRoot, 'notices')
  const correspondingSource = join(noticesDir, 'obs-studio-32.1.2-axistream-corresponding-source.tar.xz')
  mkdirSync(noticesDir, { recursive: true })
  rmSync(correspondingSource, { force: true })
  await run('tar', [
    '--exclude=.git', '--exclude=_flatpak_build', '-cJf', correspondingSource,
    '-C', sourceRoot, '.',
  ])
  const outputDir = join(assetRoot, 'linux')
  const bundle = join(outputDir, cfg.bundleFile)
  mkdirSync(outputDir, { recursive: true })
  rmSync(bundle, { force: true })
  await run('flatpak', [
    'build-bundle', '--runtime-repo=https://flathub.org/repo/flathub.flatpakrepo',
    repo, bundle, cfg.appId, cfg.branch,
  ])
  const commit = await run('ostree', [
    `--repo=${repo}`, 'rev-parse', `app/${cfg.appId}/x86_64/${cfg.branch}`,
  ], { capture: true })
  const descriptor = {
    engineId: cfg.engineId,
    obsVersion: cfg.obsVersion,
    appId: cfg.appId,
    bundleSha256: await sha256File(bundle),
    expectedRef: `app/${cfg.appId}/x86_64/${cfg.branch}`,
    expectedCommit: commit,
    expectedOrigin: cfg.expectedOrigin,
  }
  writeFileSync(join(outputDir, 'runtime-manifest.json'), `${JSON.stringify(descriptor, null, 2)}\n`)
  await downloadVerified(cfg.sourceUrl, join(assetRoot, 'notices', 'obs-studio-32.1.2-source.tar.gz'), cfg.sourceSha256)
}

if (requested === 'windows') await prepareWindows()
else if (requested === 'linux') await prepareLinux()
else if (requested === 'all') { await prepareWindows(); await prepareLinux() }
else throw new Error(`Unsupported OBS runtime platform: ${requested}`)
