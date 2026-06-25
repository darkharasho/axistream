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

  private async setDeviceFor(inputName: string, deviceId: string): Promise<void> {
    try {
      await this.d.client().call('SetInputSettings', {
        inputName, inputSettings: { device_id: deviceId }, overlay: true,
      })
    } catch (e) { console.warn('[audio] SetInputSettings failed', e) }
  }

  private async listDevicesFor(inputName: string): Promise<AudioDevice[]> {
    try {
      const r = await this.d.client().call('GetInputPropertiesListPropertyItems', {
        inputName, propertyName: 'device_id',
      })
      return (r.propertyItems ?? []).map((it: { itemName: string; itemValue: string }) => ({
        id: it.itemValue, name: it.itemName,
      }))
    } catch (e) { console.warn('[audio] list devices failed', e); return [] }
  }

  async setMicDevice(deviceId: string): Promise<void> { await this.setDeviceFor(MIC, deviceId) }
  async listMicDevices(): Promise<AudioDevice[]> { return this.listDevicesFor(MIC) }
  async setDesktopDevice(deviceId: string): Promise<void> { await this.setDeviceFor(DESKTOP_AUDIO, deviceId) }
  async listDesktopDevices(): Promise<AudioDevice[]> { return this.listDevicesFor(DESKTOP_AUDIO) }

  async applySettings(s: { desktopEnabled: boolean; desktopDevice: string | null; micEnabled: boolean; micDevice: string | null }): Promise<void> {
    if (s.desktopDevice) await this.setDesktopDevice(s.desktopDevice)
    if (s.micDevice) await this.setMicDevice(s.micDevice)
    await this.setDesktopEnabled(s.desktopEnabled)
    await this.setMicEnabled(s.micEnabled)
  }
}
