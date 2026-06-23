const fs = require('fs')
const path = require('path')
const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'
const SPIKE_COLLECTION = 'AxiStreamSpike'
const SOURCE = process.env.SPIKE_SOURCE || 'Guild Wars 2 - Pipewire'
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

// FEASIBILITY TEST: read the restore token from the user's existing, working
// capture source, then create a brand-new source in an isolated collection with
// that token injected. If it renders WITHOUT a portal prompt, the "approve once,
// reuse token forever" provisioning model is viable.
module.exports = async function tokenReuseProbe() {
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  let restoreToOriginal = null
  try {
    await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)

    // Make sure we can see the user's source (be on their collection).
    const coll = await callReady(obs, 'GetSceneCollectionList')
    restoreToOriginal = coll.currentSceneCollectionName
    if (coll.currentSceneCollectionName !== USER_COLLECTION && coll.sceneCollections.includes(USER_COLLECTION)) {
      await callReady(obs, 'SetCurrentSceneCollection', { sceneCollectionName: USER_COLLECTION })
      await callReady(obs, 'GetSceneList'); await sleep(1500)
    }

    // Read the existing source's settings (incl. its restore token + monitor).
    const { inputSettings: srcSettings } = await callReady(obs, 'GetInputSettings', { inputName: SOURCE })
    const token = srcSettings.RestoreToken || srcSettings.restore_token || ''
    const tokenPresent = !!token

    // Switch to the isolated spike collection.
    if (!coll.sceneCollections.includes(SPIKE_COLLECTION)) {
      await callReady(obs, 'CreateSceneCollection', { sceneCollectionName: SPIKE_COLLECTION })
    } else {
      await callReady(obs, 'SetCurrentSceneCollection', { sceneCollectionName: SPIKE_COLLECTION })
    }
    await callReady(obs, 'GetSceneList'); await sleep(1500)

    // Clear leftovers, then create a fresh source WITH the injected token +
    // whatever capture-target settings the original used.
    try {
      const { inputs } = await callReady(obs, 'GetInputList')
      for (const inp of inputs) if (/^spike/i.test(inp.inputName)) {
        try { await callReady(obs, 'RemoveInput', { inputName: inp.inputName }) } catch (_) {}
      }
    } catch (_) {}

    const sceneName = 'spike-token-scene'
    try { await callReady(obs, 'RemoveScene', { sceneName }) } catch (_) {}
    await callReady(obs, 'CreateScene', { sceneName })
    await callReady(obs, 'SetCurrentProgramScene', { sceneName })

    // Copy the original settings verbatim (carries capture_type/monitor) plus token.
    const injectedSettings = { ...srcSettings }
    await callReady(obs, 'CreateInput', {
      sceneName, inputName: 'spike-capture',
      inputKind: 'pipewire-screen-capture-source',
      inputSettings: injectedSettings,
    })

    // Give it time; if NO portal is needed, it should render quickly.
    await sleep(8000)

    let buf = null, shotErr = null
    for (let i = 0; i < 6; i++) {
      try {
        const shot = await callReady(obs, 'GetSourceScreenshot',
          { sourceName: 'spike-capture', imageFormat: 'png', imageWidth: 640 }, 1)
        buf = Buffer.from((shot.imageData || '').split(',')[1] || '', 'base64')
        break
      } catch (e) { shotErr = String(e); await sleep(1500) }
    }

    let savedPng = null
    if (buf) {
      savedPng = path.join(__dirname, '..', 'out', 'linux-07-token-reuse.png')
      fs.writeFileSync(savedPng, buf)
    }
    // Clean up the spike source so the collection is left empty.
    try { await callReady(obs, 'RemoveInput', { inputName: 'spike-capture' }, 3) } catch (_) {}

    return {
      ok: !!buf && pngLooksNonBlack(buf),
      tokenPresentInOriginal: tokenPresent,
      tokenReuseRendered: !!buf && pngLooksNonBlack(buf),
      originalSettingsKeys: Object.keys(srcSettings),
      imageBytes: buf ? buf.length : 0,
      savedPng,
      shotErr: buf ? null : shotErr,
    }
  } finally {
    try {
      if (restoreToOriginal && restoreToOriginal !== SPIKE_COLLECTION) {
        await callReady(obs, 'SetCurrentSceneCollection', { sceneCollectionName: restoreToOriginal }, 5)
      }
    } catch (_) {}
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
