const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455
const PASSWORD = 'spikepw123'

module.exports = async function connectProbe() {
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  try {
    const { obsWebSocketVersion, negotiatedRpcVersion } =
      await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)
    const ver = await obs.call('GetVersion')
    return {
      ok: true,
      obsWebSocketVersion,
      negotiatedRpcVersion,
      obsVersion: ver.obsVersion,
      platform: ver.platform,
      platformDescription: ver.platformDescription,
      supportedImageFormats: ver.supportedImageFormats,
      availableRequests: Array.isArray(ver.availableRequests) ? ver.availableRequests.length : null,
    }
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
