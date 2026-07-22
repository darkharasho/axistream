import { createHash } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export async function sha256File(path) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

function assertRegularFile(path, message) {
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(message)
}

export async function verifyRuntimeAssets(platform, root, manifest) {
  if (platform === 'win32') {
    const archive = join(root, 'windows', manifest.windows.archiveFile)
    assertRegularFile(archive, `Missing owned Windows OBS runtime: ${archive}`)
    if (await sha256File(archive) !== manifest.windows.archiveSha256) {
      throw new Error(`Owned Windows OBS runtime hash mismatch: ${archive}`)
    }
    return
  }
  if (platform === 'linux') {
    const bundle = join(root, 'linux', manifest.linux.bundleFile)
    const descriptorPath = join(root, 'linux', 'runtime-manifest.json')
    assertRegularFile(bundle, `Missing owned Linux OBS runtime: ${bundle}`)
    assertRegularFile(descriptorPath, `Missing owned Linux OBS runtime descriptor: ${descriptorPath}`)
    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
    if (
      descriptor.engineId !== 'axistream-obs-linux-32.1.2' ||
      descriptor.obsVersion !== '32.1.2' ||
      descriptor.appId !== 'link.axi.AxiStream.OBS' ||
      descriptor.expectedRef !== 'app/link.axi.AxiStream.OBS/x86_64/stable' ||
      typeof descriptor.expectedCommit !== 'string' || !descriptor.expectedCommit ||
      typeof descriptor.expectedOrigin !== 'string' || !descriptor.expectedOrigin ||
      !/^[a-f0-9]{64}$/.test(descriptor.bundleSha256)
    ) throw new Error(`Invalid owned Linux OBS runtime descriptor: ${descriptorPath}`)
    if (await sha256File(bundle) !== descriptor.bundleSha256) {
      throw new Error(`Owned Linux OBS runtime hash mismatch: ${bundle}`)
    }
  }
}
