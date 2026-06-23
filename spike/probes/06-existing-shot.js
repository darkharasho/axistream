const fs = require('fs')
const path = require('path')
const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function callReady(obs, req, data, tries = 25) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try { return await obs.call(req, data) }
    catch (e) { lastErr = e; await sleep(800) }
  }
  throw lastErr
}

function pngLooksNonBlack(buf) {
  if (!buf || buf.length < 200) return false
  const seen = new Set()
  for (let i = 0; i < buf.length; i += 7) seen.add(buf[i])
  return buf.length > 2000 && seen.size > 20
}

// READ-ONLY: screenshot an already-configured source in the user's current
// collection (default their working GW2 PipeWire capture). Does NOT switch
// collections or create/remove anything.
module.exports = async function existingShotProbe() {
  const sourceName = process.env.SPIKE_SOURCE || 'Guild Wars 2 - Pipewire'
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  try {
    await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)

    // Ensure we're on the user's real collection (restores it if a prior run
    // left OBS switched to AxiStreamSpike).
    const userCollection = process.env.SPIKE_USER_COLLECTION || 'Untitled'
    const coll = await callReady(obs, 'GetSceneCollectionList')
    if (coll.currentSceneCollectionName !== userCollection &&
        coll.sceneCollections.includes(userCollection)) {
      await callReady(obs, 'SetCurrentSceneCollection', { sceneCollectionName: userCollection })
      await callReady(obs, 'GetSceneList') // wait for reload
      await sleep(2000)
    }

    const { inputs } = await callReady(obs, 'GetInputList')
    const names = inputs.map(i => i.inputName)
    const exists = names.includes(sourceName)

    let buf = null, shotErr = null
    if (exists) {
      // Give the auto-restored capture a few seconds to deliver frames.
      await sleep(6000)
      for (let i = 0; i < 10; i++) {
        try {
          const shot = await callReady(obs, 'GetSourceScreenshot',
            { sourceName, imageFormat: 'png', imageWidth: 960 }, 1)
          buf = Buffer.from((shot.imageData || '').split(',')[1] || '', 'base64')
          break
        } catch (e) { shotErr = String(e); await sleep(1500) }
      }
    }

    let savedPng = null
    if (buf) {
      savedPng = path.join(__dirname, '..', 'out', 'linux-06-existing.png')
      fs.writeFileSync(savedPng, buf)
    }
    return {
      ok: !!buf && pngLooksNonBlack(buf),
      sourceName,
      sourceExists: exists,
      availableInputs: names,
      imageBytes: buf ? buf.length : 0,
      nonBlackHeuristic: buf ? pngLooksNonBlack(buf) : false,
      savedPng,
      shotErr: buf ? null : shotErr,
    }
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
