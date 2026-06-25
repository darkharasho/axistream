import { describe, it, expect, vi } from 'vitest'
import { AudioController, DESKTOP_AUDIO, MIC } from '../src/main/AudioController.js'

function recorder(responses: Record<string, any> = {}) {
  const calls: { req: string; data: any }[] = []
  const client = () => ({
    call: vi.fn(async (req: string, data?: any) => { calls.push({ req, data }); return responses[req] ?? {} }),
  })
  return { calls, client }
}

describe('AudioController', () => {
  it('setDesktopEnabled mutes/unmutes the desktop input', async () => {
    const r = recorder()
    const a = new AudioController({ client: r.client })
    await a.setDesktopEnabled(false)
    await a.setDesktopEnabled(true)
    expect(r.calls[0]).toEqual({ req: 'SetInputMute', data: { inputName: DESKTOP_AUDIO, inputMuted: true } })
    expect(r.calls[1]).toEqual({ req: 'SetInputMute', data: { inputName: DESKTOP_AUDIO, inputMuted: false } })
  })

  it('setMicEnabled mutes/unmutes the mic input', async () => {
    const r = recorder()
    const a = new AudioController({ client: r.client })
    await a.setMicEnabled(true)
    expect(r.calls[0]).toEqual({ req: 'SetInputMute', data: { inputName: MIC, inputMuted: false } })
  })

  it('setMicDevice sets device_id with overlay', async () => {
    const r = recorder()
    const a = new AudioController({ client: r.client })
    await a.setMicDevice('dev-1')
    expect(r.calls[0]).toEqual({ req: 'SetInputSettings', data: { inputName: MIC, inputSettings: { device_id: 'dev-1' }, overlay: true } })
  })

  it('listMicDevices maps property items to {id,name}', async () => {
    const r = recorder({ GetInputPropertiesListPropertyItems: { propertyItems: [
      { itemName: 'Default', itemEnabled: true, itemValue: 'default' },
      { itemName: 'Yeti', itemEnabled: true, itemValue: 'alsa_input.yeti' },
    ] } })
    const a = new AudioController({ client: r.client })
    expect(await a.listMicDevices()).toEqual([
      { id: 'default', name: 'Default' },
      { id: 'alsa_input.yeti', name: 'Yeti' },
    ])
  })

  it('setDesktopDevice sets device_id on the desktop input', async () => {
    const r = recorder()
    const a = new AudioController({ client: r.client })
    await a.setDesktopDevice('out-2')
    expect(r.calls[0]).toEqual({ req: 'SetInputSettings', data: { inputName: DESKTOP_AUDIO, inputSettings: { device_id: 'out-2' }, overlay: true } })
  })

  it('listDesktopDevices maps property items from the desktop input', async () => {
    const r = recorder({ GetInputPropertiesListPropertyItems: { propertyItems: [
      { itemName: 'HDMI', itemValue: 'hdmi.monitor' },
    ] } })
    const a = new AudioController({ client: r.client })
    expect(await a.listDesktopDevices()).toEqual([{ id: 'hdmi.monitor', name: 'HDMI' }])
    expect(r.calls[0].data).toEqual({ inputName: DESKTOP_AUDIO, propertyName: 'device_id' })
  })

  it('applySettings applies desktop device, mic device, then desktop+mic mute', async () => {
    const r = recorder()
    const a = new AudioController({ client: r.client })
    await a.applySettings({ desktopEnabled: false, desktopDevice: 'out-9', micEnabled: true, micDevice: 'mic-9' })
    expect(r.calls.map((c) => c.req)).toEqual(['SetInputSettings', 'SetInputSettings', 'SetInputMute', 'SetInputMute'])
    expect(r.calls[0].data).toEqual({ inputName: DESKTOP_AUDIO, inputSettings: { device_id: 'out-9' }, overlay: true })
    expect(r.calls[1].data).toEqual({ inputName: MIC, inputSettings: { device_id: 'mic-9' }, overlay: true })
    expect(r.calls[2].data).toEqual({ inputName: DESKTOP_AUDIO, inputMuted: true })
    expect(r.calls[3].data).toEqual({ inputName: MIC, inputMuted: false })
  })

  it('swallows client errors (never throws out)', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('boom') }) })
    const a = new AudioController({ client })
    await expect(a.setMicEnabled(true)).resolves.toBeUndefined()
    await expect(a.listMicDevices()).resolves.toEqual([])
  })
})
