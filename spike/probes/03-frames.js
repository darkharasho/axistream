const fs = require('fs')
const path = require('path')
const { openIsolatedSession, sleep } = require('../session')

const SCREEN_KIND_HINTS = [
  'pipewire-screen-capture-source', 'pipewire-desktop-capture-source',
  'monitor_capture', 'xshm_input', 'screen_capture', 'display_capture',
]

function pngLooksNonBlack(buf) {
  if (!buf || buf.length < 200) return false
  const seen = new Set()
  for (let i = 0; i < buf.length; i += 7) seen.add(buf[i])
  return buf.length > 2000 && seen.size > 20
}

async function clearSpikeInputs(s) {
  try {
    const { inputs } = await s.callReady('GetInputList')
    for (const inp of inputs) {
      if (/^spike/i.test(inp.inputName)) {
        try { await s.callReady('RemoveInput', { inputName: inp.inputName }) } catch (_) {}
      }
    }
  } catch (_) {}
}

module.exports = async function framesProbe() {
  const s = await openIsolatedSession()
  try {
    // Clear any leftover spike sources FIRST so OBS's auto-restore portal (if
    // any) is gone before we open the real one the user must approve.
    await clearSpikeInputs(s)

    const { inputKinds } = await s.callReady('GetInputKindList')
    const screenKind = process.env.SPIKE_SCREEN_KIND || SCREEN_KIND_HINTS.find(k => inputKinds.includes(k))

    const sceneName = 'spike-frames-scene'
    try { await s.callReady('RemoveScene', { sceneName }) } catch (_) {}
    await s.callReady('CreateScene', { sceneName })
    await s.callReady('SetCurrentProgramScene', { sceneName })
    await s.callReady('CreateInput', { sceneName, inputName: 'spike-capture', inputKind: screenKind, inputSettings: {} })

    // Wait up to 60s for portal approval, detected via a populated RestoreToken.
    let tokenSeen = false
    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      try {
        const { inputSettings } = await s.callReady('GetInputSettings', { inputName: 'spike-capture' }, 2)
        if (inputSettings && (inputSettings.RestoreToken || inputSettings.restore_token)) { tokenSeen = true; break }
      } catch (_) {}
    }

    // Only attempt screenshots if approved (else bail fast — no hanging).
    let buf = null, shotErr = null
    if (tokenSeen) {
      await sleep(2500) // let first PipeWire frame arrive
      for (let i = 0; i < 8; i++) {
        try {
          const shot = await s.callReady('GetSourceScreenshot',
            { sourceName: 'spike-capture', imageFormat: 'png', imageWidth: 960 }, 2)
          buf = Buffer.from((shot.imageData || '').split(',')[1] || '', 'base64')
          break
        } catch (e) { shotErr = String(e); await sleep(1500) }
      }
    }

    let savedPng = null
    if (buf) {
      savedPng = path.join(__dirname, '..', 'out', 'linux-03-frames.png')
      fs.writeFileSync(savedPng, buf)
    }
    return {
      ok: !!buf && pngLooksNonBlack(buf),
      screenKind,
      tokenSeen,
      imageBytes: buf ? buf.length : 0,
      nonBlackHeuristic: buf ? pngLooksNonBlack(buf) : false,
      savedPng,
      shotErr: buf ? null : (tokenSeen ? shotErr : 'portal not approved (no restore token within 60s)'),
    }
  } finally {
    await clearSpikeInputs(s)   // leave the isolated collection empty
    await s.cleanup()           // restore user's collection + tear down OBS
  }
}
