const { join, resolve } = require('node:path')
const { readFileSync } = require('node:fs')

module.exports = async function beforePack(context) {
  const repoRoot = resolve(__dirname, '..')
  const root = join(repoRoot, 'resources', 'obs-runtime')
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  const { verifyRuntimeAssets } = await import('./obs-runtime-lib.mjs')
  await verifyRuntimeAssets(context.electronPlatformName, root, manifest)
}
