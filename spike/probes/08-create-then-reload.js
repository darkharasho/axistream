const fs = require('fs')
const path = require('path')
const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'
const SPIKE_COLLECTION = 'AxiStreamSpike'
const USER_COLLECTION = process.env.SPIKE_USER_COLLECTION || 'Untitled'
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

async function connect() {
  const obs = new OBSWebSocket()
  await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)
  return obs
}

// Decisive test: build a capture source over the socket, persist it (switching
// collections forces a save), then RELOAD OBS pointed at that collection and see
// if the now-config-loaded source renders (prompting the portal the first time).
module.exports = async function createThenReloadProbe() {
  // ---- Phase 1: build the collection over the socket, then persist ----
  let handle = await launchObs({ port: PORT, password: PASSWORD })
  let obs = await connect()
  try {
    const coll = await callReady(obs, 'GetSceneCollectionList')
    if (!coll.sceneCollections.includes(SPIKE_COLLECTION)) {
      await callReady(obs, 'CreateSceneCollection', { sceneCollectionName: SPIKE_COLLECTION })
    } else {
      await callReady(obs, 'SetCurrentSceneCollection', { sceneCollectionName: SPIKE_COLLECTION })
    }
    await callReady(obs, 'GetSceneList'); await sleep(1500)

    try {
      const { inputs } = await callReady(obs, 'GetInputList')
      for (const inp of inputs) if (/^spike/i.test(inp.inputName)) {
        try { await callReady(obs, 'RemoveInput', { inputName: inp.inputName }) } catch (_) {}
      }
    } catch (_) {}

    const sceneName = 'spike-reload-scene'
    try { await callReady(obs, 'RemoveScene', { sceneName }) } catch (_) {}
    await callReady(obs, 'CreateScene', { sceneName })
    await callReady(obs, 'SetCurrentProgramScene', { sceneName })
    await callReady(obs, 'CreateInput', {
      sceneName, inputName: 'spike-capture',
      inputKind: 'pipewire-screen-capture-source', inputSettings: {},
    })
    // Switch away to the user's collection -> forces OBS to save the spike one.
    await callReady(obs, 'SetCurrentSceneCollection', { sceneCollectionName: USER_COLLECTION })
    await callReady(obs, 'GetSceneList'); await sleep(2000)
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
  await sleep(3000) // let OBS fully exit

  // ---- Phase 2: reload OBS forced onto the spike collection ----
  process.env.SPIKE_OBS_COLLECTION = SPIKE_COLLECTION
  handle = await launchObs({ port: PORT, password: PASSWORD })
  obs = await connect()
  try {
    await callReady(obs, 'GetSceneList'); await sleep(1500)
    const { inputs } = await callReady(obs, 'GetInputList')
    const loaded = inputs.map(i => i.inputName)
    const sourcePresent = loaded.includes('spike-capture')

    // Wait for portal approval (first time) up to 60s via render success.
    let buf = null, shotErr = null
    for (let i = 0; i < 40; i++) {
      try {
        const shot = await callReady(obs, 'GetSourceScreenshot',
          { sourceName: 'spike-capture', imageFormat: 'png', imageWidth: 640 }, 1)
        const b = Buffer.from((shot.imageData || '').split(',')[1] || '', 'base64')
        if (pngLooksNonBlack(b)) { buf = b; break }
        shotErr = 'rendered but black'
      } catch (e) { shotErr = String(e) }
      await sleep(1500)
    }

    let savedPng = null
    if (buf) {
      savedPng = path.join(__dirname, '..', 'out', 'linux-08-reload.png')
      fs.writeFileSync(savedPng, buf)
    }
    return {
      ok: !!buf,
      sourcePersistedAndReloaded: sourcePresent,
      renderedAfterReload: !!buf,
      imageBytes: buf ? buf.length : 0,
      savedPng,
      shotErr: buf ? null : shotErr,
    }
  } finally {
    delete process.env.SPIKE_OBS_COLLECTION
    try { await callReady(obs, 'SetCurrentSceneCollection', { sceneCollectionName: USER_COLLECTION }, 5) } catch (_) {}
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
