const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('./obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'
const SPIKE_COLLECTION = 'AxiStreamSpike'
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Retry a websocket call through OBS's startup/"not ready" window.
async function callReady(obs, request, data, tries = 25) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try { return await obs.call(request, data) }
    catch (e) { lastErr = e; await sleep(800) }
  }
  throw lastErr
}

// Launch OBS, connect, and switch into an ISOLATED throwaway scene collection
// so the spike never mutates the user's real (e.g. GW2) scenes. Returns the
// connected client plus a cleanup() that restores the user's collection and
// tears OBS down.
async function openIsolatedSession() {
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)

  const list = await callReady(obs, 'GetSceneCollectionList')
  const original = list.currentSceneCollectionName

  // Create the spike collection if absent (this also switches to it), else
  // just switch to it. A fresh collection starts with one empty default scene.
  if (!list.sceneCollections.includes(SPIKE_COLLECTION)) {
    await callReady(obs, 'CreateSceneCollection', { sceneCollectionName: SPIKE_COLLECTION })
  } else {
    await callReady(obs, 'SetCurrentSceneCollection', { sceneCollectionName: SPIKE_COLLECTION })
  }
  // Switching collections triggers a reload; wait until ready again.
  await callReady(obs, 'GetSceneList')

  return {
    obs,
    original,
    callReady: (req, data, tries) => callReady(obs, req, data, tries),
    async cleanup() {
      try {
        if (original && original !== SPIKE_COLLECTION) {
          await callReady(obs, 'SetCurrentSceneCollection', { sceneCollectionName: original })
        }
      } catch (_) {}
      try { await obs.disconnect() } catch (_) {}
      handle.disconnect()
    },
  }
}

module.exports = { openIsolatedSession, SPIKE_COLLECTION, sleep }
