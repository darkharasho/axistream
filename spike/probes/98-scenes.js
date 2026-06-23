const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'

// Read-only: report current scene collection, scenes, and inputs. No mutation.
module.exports = async function scenesProbe() {
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  try {
    await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)
    // OBS can report "not ready" while still loading its scene collection on
    // startup — retry until it settles.
    let coll
    for (let i = 0; i < 20; i++) {
      try { coll = await obs.call('GetSceneCollectionList'); break }
      catch (e) { await new Promise(r => setTimeout(r, 1000)) }
    }
    if (!coll) throw new Error('OBS never became ready')
    const scenes = await obs.call('GetSceneList')
    const inputs = await obs.call('GetInputList')
    return {
      ok: true,
      currentSceneCollection: coll.currentSceneCollectionName,
      sceneCollections: coll.sceneCollections,
      scenes: scenes.scenes.map(s => s.sceneName),
      spikeScenesRemaining: scenes.scenes.map(s => s.sceneName).filter(n => /^axistream-spike/i.test(n)),
      spikeInputsRemaining: inputs.inputs.map(i => i.inputName).filter(n => /^spike/i.test(n)),
    }
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
