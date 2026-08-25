import { describe, it, expect, vi } from 'vitest'
import { toast } from '../src/main/toast.js'
import { CH } from '../src/shared/state.js'

const fakeWin = (destroyed = false) => ({
  isDestroyed: () => destroyed,
  webContents: { send: vi.fn() },
})

describe('main toast helper', () => {
  it('sends the payload on the toast channel', () => {
    const win = fakeWin()
    toast(win, { kind: 'error', message: 'Announce failed', detail: 'HTTP 401' })
    expect(win.webContents.send).toHaveBeenCalledWith(CH.evtToast, {
      kind: 'error', message: 'Announce failed', detail: 'HTTP 401',
    })
  })

  it('is a no-op when the window is null', () => {
    expect(() => toast(null, { kind: 'info', message: 'x' })).not.toThrow()
  })

  it('is a no-op when the window is destroyed', () => {
    const win = fakeWin(true)
    toast(win, { kind: 'info', message: 'x' })
    expect(win.webContents.send).not.toHaveBeenCalled()
  })

  it('never throws out when send fails', () => {
    const win = { isDestroyed: () => false, webContents: { send: () => { throw new Error('gone') } } }
    expect(() => toast(win, { kind: 'info', message: 'x' })).not.toThrow()
  })
})
