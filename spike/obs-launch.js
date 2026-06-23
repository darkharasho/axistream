const { spawn } = require('child_process')
const net = require('net')

// Resolve how to launch OBS on this platform.
function findObsCommand() {
  if (process.platform === 'linux') {
    // Bazzite / immutable: Flatpak OBS is the natural install.
    return { cmd: 'flatpak', args: ['run', 'com.obsproject.Studio'], cwd: undefined }
  }
  if (process.platform === 'win32') {
    // OBS must be launched from its bin/64bit dir (it resolves data relatively).
    const dir = 'C:/Program Files/obs-studio/bin/64bit'
    return { cmd: `${dir}/obs64.exe`, args: [], cwd: dir }
  }
  if (process.platform === 'darwin') {
    return { cmd: '/Applications/OBS.app/Contents/MacOS/OBS', args: [], cwd: undefined }
  }
  throw new Error(`unsupported platform ${process.platform}`)
}

// Poll a TCP port until it accepts connections (OBS websocket is up) or we time out.
function waitForPort(port, timeoutMs) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(port, '127.0.0.1')
      sock.once('connect', () => { sock.destroy(); resolve(true) })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`OBS websocket port ${port} never opened within ${timeoutMs}ms`))
        }
        setTimeout(tryOnce, 500)
      })
    }
    tryOnce()
  })
}

// Launch OBS as a managed child process with the websocket server enabled via flags.
async function launchObs({ port, password }) {
  const { cmd, args, cwd } = findObsCommand()
  const obsArgs = [
    ...args,
    '--websocket_port', String(port),
    '--websocket_password', password,
    '--websocket_debug',
    '--multi',                 // allow running alongside any existing OBS instance
    '--disable-shutdown-check',
    '--minimize-to-tray',      // first probe of "hidden" operation
  ]
  const proc = spawn(cmd, obsArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout.on('data', d => process.stdout.write(`[obs] ${d}`))
  proc.stderr.on('data', d => process.stderr.write(`[obs] ${d}`))
  proc.on('error', e => process.stderr.write(`[obs spawn error] ${e}\n`))

  await waitForPort(port, 30000)
  return {
    proc,
    disconnect() { try { proc.kill() } catch (_) {} },
  }
}

module.exports = { launchObs, findObsCommand }
