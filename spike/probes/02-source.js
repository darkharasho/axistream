const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'
const SCREEN_KIND_HINTS = [
  'pipewire-screen-capture-source',   // Linux Wayland (PipeWire) — OBS 32 / KDE
  'pipewire-desktop-capture-source',  // older OBS naming
  'monitor_capture',                  // Windows
  'xshm_input',                       // Linux X11
  'screen_capture', 'display_capture' // macOS / generic
]
const sleep = ms => new Promise(r => setTimeout(r, ms))

// A Wayland PipeWire source stores its persistent-permission handle in a
// settings field. The exact key varies; grab whatever looks like a token.
function extractRestoreToken(settings) {
  if (!settings) return null
  for (const k of Object.keys(settings)) {
    if (/restore.?token/i.test(k) && settings[k]) return { key: k, value: settings[k] }
  }
  return null
}

module.exports = async function sourceProbe() {
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  try {
    await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)
    const { inputKinds } = await obs.call('GetInputKindList')
    const screenKind = SCREEN_KIND_HINTS.find(k => inputKinds.includes(k))
    if (!screenKind) return { ok: false, reason: 'no screen-capture input kind registered', inputKinds }

    // If a restore token was captured on a prior run, inject it to test whether
    // the portal approval persists (no second prompt).
    const inputSettings = {}
    const injectedToken = process.env.SPIKE_RESTORE_TOKEN
    if (injectedToken) inputSettings.RestoreToken = injectedToken

    const sceneName = 'axistream-spike-scene'
    await obs.call('CreateScene', { sceneName })
    await obs.call('CreateInput', {
      sceneName, inputName: 'spike-capture', inputKind: screenKind, inputSettings,
    })

    // On Wayland this is when the xdg-desktop-portal screen-share dialog appears
    // (unless a valid restore token suppressed it).
    await sleep(20000)

    const { inputSettings: settled } = await obs.call('GetInputSettings', { inputName: 'spike-capture' })
    const token = extractRestoreToken(settled)

    return {
      ok: true,
      screenKind,
      injectedToken: injectedToken ? `${injectedToken.slice(0, 8)}…` : null,
      restoreToken: token ? { key: token.key, value: token.value } : null,
      settledSettings: settled,
      note: 'On Wayland a portal dialog should appear on first run. Capture restoreToken.value and re-run with SPIKE_RESTORE_TOKEN set to test persistence (no second prompt = persists).',
    }
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
