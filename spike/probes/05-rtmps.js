const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'
const CAPTURE_SOURCE = process.env.SPIKE_SOURCE || 'Guild Wars 2 - Pipewire'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function callReady(obs, req, data, tries = 25) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try { return await obs.call(req, data) }
    catch (e) { lastErr = e; await sleep(800) }
  }
  throw lastErr
}

// Find a scene that contains the capture source, so the stream isn't black.
async function findSceneWithSource(obs, sourceName) {
  const { scenes } = await callReady(obs, 'GetSceneList')
  for (const sc of scenes) {
    try {
      const { sceneItems } = await callReady(obs, 'GetSceneItemList', { sceneName: sc.sceneName }, 2)
      if (sceneItems.some(it => it.sourceName === sourceName)) return sc.sceneName
    } catch (_) {}
  }
  return null
}

// End-to-end: stream the user's real GW2 scene to YouTube RTMPS for ~20s, then
// restore their original stream settings + program scene. Never returns the key.
module.exports = async function rtmpsProbe() {
  const key = process.env.SPIKE_YT_KEY
  if (!key) return { ok: false, error: 'SPIKE_YT_KEY not set' }

  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  let originalService = null, originalScene = null
  try {
    await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)

    // Ensure we're on the user's real collection.
    const userCollection = process.env.SPIKE_USER_COLLECTION || 'Untitled'
    const coll = await callReady(obs, 'GetSceneCollectionList')
    if (coll.currentSceneCollectionName !== userCollection && coll.sceneCollections.includes(userCollection)) {
      await callReady(obs, 'SetCurrentSceneCollection', { sceneCollectionName: userCollection })
      await callReady(obs, 'GetSceneList'); await sleep(2000)
    }

    // Don't double-start if OBS is already streaming.
    const pre = await callReady(obs, 'GetStreamStatus')
    if (pre.outputActive) return { ok: false, error: 'OBS is already streaming; aborting to avoid disruption' }

    // Remember current program scene; switch to one that shows the capture.
    originalScene = (await callReady(obs, 'GetCurrentProgramScene')).currentProgramSceneName
    const streamScene = (await findSceneWithSource(obs, CAPTURE_SOURCE)) || originalScene
    if (streamScene && streamScene !== originalScene) {
      await callReady(obs, 'SetCurrentProgramScene', { sceneName: streamScene })
    }
    await sleep(6000) // let the auto-restored capture render

    // Save + override stream service, point at YouTube RTMPS.
    originalService = await callReady(obs, 'GetStreamServiceSettings')
    await callReady(obs, 'SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: 'rtmps://a.rtmps.youtube.com/live2', key },
    })

    await callReady(obs, 'StartStream')
    const byteSamples = []
    let status
    for (let i = 0; i < 20; i++) {
      await sleep(1000)
      status = await callReady(obs, 'GetStreamStatus')
      byteSamples.push(status.outputBytes)
    }
    await callReady(obs, 'StopStream')
    await sleep(2000)

    const climbed = byteSamples.length > 1 && byteSamples[byteSamples.length - 1] > byteSamples[0]
    return {
      ok: status.outputActive === true && status.outputReconnecting !== true && climbed,
      streamScene,
      finalStatus: {
        outputActive: status.outputActive,
        outputReconnecting: status.outputReconnecting,
        outputDuration: status.outputDuration,
        outputBytes: status.outputBytes,
        outputSkippedFrames: status.outputSkippedFrames,
        outputTotalFrames: status.outputTotalFrames,
      },
      bytesClimbed: climbed,
      byteSamples,
    }
  } finally {
    // Restore the user's stream service + program scene. (Never logs the key.)
    try {
      if (originalService) {
        await callReady(obs, 'SetStreamServiceSettings', {
          streamServiceType: originalService.streamServiceType,
          streamServiceSettings: originalService.streamServiceSettings,
        }, 5)
      }
    } catch (_) {}
    try { if (originalScene) await callReady(obs, 'SetCurrentProgramScene', { sceneName: originalScene }, 5) } catch (_) {}
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
