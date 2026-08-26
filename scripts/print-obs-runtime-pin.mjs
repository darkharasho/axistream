#!/usr/bin/env node
// Emits the resources/obs-runtime/manifest.json `linux.prebuilt` block for the
// runtime obs-runtime.yml just published, so pinning it is a copy-paste rather
// than six hashes typed by hand.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256File } from './obs-runtime-lib.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetRoot = join(repoRoot, 'resources', 'obs-runtime')
const manifest = JSON.parse(readFileSync(join(assetRoot, 'manifest.json'), 'utf8'))
const cfg = manifest.linux
const tag = process.argv[2]
if (!tag) throw new Error('Usage: print-obs-runtime-pin.mjs <release-tag>')

const base = `https://github.com/darkharasho/axistream/releases/download/${tag}`
const sourceName = `obs-studio-${cfg.obsVersion}-axistream-corresponding-source.tar.xz`
const prebuilt = {
  obsVersion: cfg.obsVersion,
  bundleUrl: `${base}/${cfg.bundleFile}`,
  bundleSha256: await sha256File(join(assetRoot, 'linux', cfg.bundleFile)),
  descriptorUrl: `${base}/runtime-manifest.json`,
  descriptorSha256: await sha256File(join(assetRoot, 'linux', 'runtime-manifest.json')),
  correspondingSourceUrl: `${base}/${sourceName}`,
  correspondingSourceSha256: await sha256File(join(assetRoot, 'notices', sourceName)),
}

console.log('Paste into `linux.prebuilt` in resources/obs-runtime/manifest.json:\n')
console.log('```json')
console.log(JSON.stringify({ prebuilt }, null, 2))
console.log('```')
