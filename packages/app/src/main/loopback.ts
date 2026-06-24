import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { LoopbackResult } from './YouTubeAuth.js'

const DONE_HTML = '<!doctype html><meta charset="utf-8"><title>AxiStream</title><body style="font-family:sans-serif;padding:2rem">You can close this window and return to AxiStream.</body>'

export function createLoopback(): Promise<LoopbackResult> {
  return new Promise((resolve) => {
    let onCode: (v: { code: string; state: string }) => void = () => {}
    const codePromise = new Promise<{ code: string; state: string }>((r) => { onCode = r })
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/callback') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(DONE_HTML)
        onCode({ code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') ?? '' })
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        redirectUri: `http://127.0.0.1:${port}/callback`,
        waitForCode: () => codePromise,
        close: () => server.close(),
      })
    })
  })
}
