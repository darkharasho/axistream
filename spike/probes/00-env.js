const { findObsCommand } = require('../obs-launch')

module.exports = async function envProbe({ os }) {
  let obsCmd = null, obsErr = null
  try { obsCmd = findObsCommand() } catch (e) { obsErr = String(e) }
  return {
    ok: !!obsCmd,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    session: process.env.XDG_SESSION_TYPE || null, // 'wayland' on Bazzite
    desktop: process.env.XDG_CURRENT_DESKTOP || null,
    osRelease: os.release(),
    obsCmd,
    obsErr,
  }
}
