const readErrorMessage = (err: unknown): string => {
  if (!err) return ''
  if (typeof err === 'string') return err
  if (typeof err === 'object') {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') return message
    const stack = (err as { stack?: unknown }).stack
    if (typeof stack === 'string' && stack.trim()) return stack.split('\n')[0].trim()
  }
  return ''
}

const summarize = (message: string): string => {
  const firstLine = String(message || '').split(/(?:\\n|[\r\n])+/)[0]?.trim() || ''
  if (!firstLine) return ''
  const dataIndex = firstLine.toLowerCase().indexOf(' data:')
  return dataIndex > -1 ? firstLine.slice(0, dataIndex).trim() : firstLine
}

export function extractAutoUpdateErrorMessage(err: unknown): string {
  return readErrorMessage(err) || (err ? 'Unknown update error' : '')
}

export function isRetryableAutoUpdateError(err: unknown): boolean {
  const m = extractAutoUpdateErrorMessage(err).toLowerCase()
  return m.includes('err_http2_server_refused_stream')
    || m.includes('econnreset') || m.includes('etimedout') || m.includes('socket hang up')
    || m.includes('timed out') || m.includes('timeout')
    || m.includes('error: 502') || m.includes('error: 503') || m.includes('error: 504')
}

export function formatAutoUpdateErrorMessage(err: unknown): string {
  const message = extractAutoUpdateErrorMessage(err)
  const n = message.toLowerCase()
  if (n.includes('err_http2_server_refused_stream')) return 'The update server temporarily refused the download stream. Please try again in a moment.'
  if ((n.includes('error: 502') || n.includes('error: 503') || n.includes('error: 504')) && (n.includes('releases.atom') || n.includes('github.com'))) return 'GitHub temporarily failed to respond to the update check. Please try again in a moment.'
  if (n.includes('timed out') || n.includes('timeout')) return 'The update check timed out before the server responded. Please try again.'
  if (n.includes('econnreset') || n.includes('etimedout') || n.includes('socket hang up')) return 'A temporary network error interrupted the update check. Please try again.'
  return summarize(message) || message
}
