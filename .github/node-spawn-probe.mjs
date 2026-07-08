import { spawn } from 'node:child_process'
import { connect } from 'node:net'
const exe = 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe'
const cwd = 'C:\\Program Files\\obs-studio\\bin\\64bit'
const proc = spawn(exe, ['--minimize-to-tray', '--websocket_ipv4_only', '--websocket_port', '4460', '--websocket_password', 'x', '--multi', '--disable-shutdown-check'], { cwd, stdio: 'ignore', detached: true })
console.log('spawned pid=', proc.pid)
proc.on('error', (e) => console.log('SPAWN ERROR', e.message))
proc.on('exit', (c, s) => console.log('EXITED', c, s))
setTimeout(() => {
  const sock = connect(4460, '127.0.0.1')
  sock.on('connect', () => { console.log('PORT CONNECT OK'); process.exit(0) })
  sock.on('error', (e) => { console.log('PORT CONNECT FAIL', e.message); process.exit(1) })
}, 20000)
