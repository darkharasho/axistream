export const DESKTOP_AUDIO = 'AxiStream Desktop Audio'
export const MIC = 'AxiStream Mic'

export interface AudioDevice { id: string; name: string }

export interface AudioDeps {
  client(): { call(req: string, data?: unknown): Promise<any> }
}

export class AudioController {
  constructor(private readonly d: AudioDeps) {}

  private async mute(inputName: string, muted: boolean): Promise<void> {
    try { await this.d.client().call('SetInputMute', { inputName, inputMuted: muted }) }
    catch (e) { console.warn('[audio] SetInputMute failed', e) }
  }

  async setDesktopEnabled(enabled: boolean): Promise<void> { await this.mute(DESKTOP_AUDIO, !enabled) }
  async setMicEnabled(enabled: boolean): Promise<void> { await this.mute(MIC, !enabled) }

  async setMicDevice(deviceId: string): Promise<void> {
    try {
      await this.d.client().call('SetInputSettings', {
        inputName: MIC, inputSettings: { device_id: deviceId }, overlay: true,
      })
    } catch (e) { console.warn('[audio] SetInputSettings failed', e) }
  }

  async listMicDevices(): Promise<AudioDevice[]> {
    try {
      const r = await this.d.client().call('GetInputPropertiesListPropertyItems', {
        inputName: MIC, propertyName: 'device_id',
      })
      return (r.propertyItems ?? []).map((it: { itemName: string; itemValue: string }) => ({
        id: it.itemValue, name: it.itemName,
      }))
    } catch (e) { console.warn('[audio] list devices failed', e); return [] }
  }

  async applySettings(s: { desktopEnabled: boolean; micEnabled: boolean; micDevice: string | null }): Promise<void> {
    if (s.micDevice) await this.setMicDevice(s.micDevice)
    await this.setDesktopEnabled(s.desktopEnabled)
    await this.setMicEnabled(s.micEnabled)
  }
}
