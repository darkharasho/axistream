const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Diagnostic + cleanup: report all inputs/scenes, then remove spike-created ones.
module.exports = async function resetProbe() {
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  try {
    await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)
    const before = await obs.call('GetInputList')
    const scenesBefore = await obs.call('GetSceneList')

    const removed = []
    for (const inp of before.inputs) {
      if (/^spike/i.test(inp.inputName)) {
        try { await obs.call('RemoveInput', { inputName: inp.inputName }); removed.push(inp.inputName) }
        catch (e) { removed.push(`${inp.inputName} FAILED: ${e}`) }
      }
    }
    await sleep(500)
    for (const sc of scenesBefore.scenes) {
      if (/^axistream-spike/i.test(sc.sceneName)) {
        try { await obs.call('RemoveScene', { sceneName: sc.sceneName }) } catch (_) {}
      }
    }
    await sleep(500)
    const after = await obs.call('GetInputList')

    return {
      ok: true,
      inputsBefore: before.inputs.map(i => ({ name: i.inputName, kind: i.inputKind })),
      scenesBefore: scenesBefore.scenes.map(s => s.sceneName),
      removed,
      inputsAfter: after.inputs.map(i => i.inputName),
    }
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
