import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
const appData = process.env.APPDATA
const dir = `${appData}\\obs-studio\\plugin_config\\obs-websocket`
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}\\config.json`, JSON.stringify({ server_enabled: true }))
console.log('config pre-written')
const exe = 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe'
const cwd = 'C:\\Program Files\\obs-studio\\bin\\64bit'
const args = ['--minimize-to-tray', '--websocket_ipv4_only', '--websocket_port', '4460', '--websocket_password', 'x', '--websocket_debug', '--multi', '--disable-shutdown-check', '--collection', 'AxiStream']
const proc = spawn(exe, args, { cwd, stdio: 'ignore', detached: true })
console.log('spawned pid=', proc.pid)
proc.on('error', (e) => console.log('SPAWN ERROR', e.message))
proc.on('exit', (c, s) => console.log('EXITED', c, s))
setTimeout(() => {
  const sock = connect(4460, '127.0.0.1')
  sock.on('connect', () => { console.log('PORT CONNECT OK'); done(0) })
  sock.on('error', (e) => { console.log('PORT CONNECT FAIL', e.message); done(1) })
}, 20000)
function done(code) {
  try {
    const logs = readdirSync(`${appData}\\obs-studio\\logs`).sort()
    const last = logs[logs.length - 1]
    const txt = readFileSync(`${appData}\\obs-studio\\logs\\${last}`, 'utf8')
    for (const line of txt.split('\n')) if (/websocket|Config::Load/i.test(line)) console.log('LOG>', line.trim())
  } catch (e) { console.log('no obs logs:', e.message) }
  process.exit(code)
}
