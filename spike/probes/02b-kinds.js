const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'

// Read-only: list input kinds + special inputs. No source creation, so no
// Wayland portal prompt. Used to discover the exact screen-capture kind id.
module.exports = async function kindsProbe() {
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  try {
    await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)
    const { inputKinds } = await obs.call('GetInputKindList')
    return { ok: true, inputKinds }
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
