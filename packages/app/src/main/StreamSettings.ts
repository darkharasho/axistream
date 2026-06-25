import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type Privacy = 'public' | 'unlisted' | 'private'

export interface StreamSettingsData {
  titleTemplate: string
  dateFormat: string
  privacy: Privacy
  counter: number
  streamId: string | null
  desktopEnabled: boolean
  micEnabled: boolean
  micDevice: string | null
  desktopDevice: string | null
}

export const DEFAULT_SETTINGS: StreamSettingsData = {
  titleTemplate: '',
  dateFormat: 'YYYY-MM-DD',
  privacy: 'public',
  counter: 0,
  streamId: null,
  desktopEnabled: true,
  micEnabled: false,
  micDevice: null,
  desktopDevice: null,
}

const PRIVACIES: Privacy[] = ['public', 'unlisted', 'private']

export class StreamSettings {
  constructor(private readonly filePath: string) {}

  load(): StreamSettingsData {
    if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StreamSettingsData>
      return {
        titleTemplate: typeof raw.titleTemplate === 'string' ? raw.titleTemplate : DEFAULT_SETTINGS.titleTemplate,
        dateFormat: typeof raw.dateFormat === 'string' && raw.dateFormat ? raw.dateFormat : DEFAULT_SETTINGS.dateFormat,
        privacy: PRIVACIES.includes(raw.privacy as Privacy) ? (raw.privacy as Privacy) : DEFAULT_SETTINGS.privacy,
        counter: Number.isInteger(raw.counter) ? (raw.counter as number) : DEFAULT_SETTINGS.counter,
        streamId: typeof raw.streamId === 'string' ? raw.streamId : null,
        desktopEnabled: typeof raw.desktopEnabled === 'boolean' ? raw.desktopEnabled : DEFAULT_SETTINGS.desktopEnabled,
        micEnabled: typeof raw.micEnabled === 'boolean' ? raw.micEnabled : DEFAULT_SETTINGS.micEnabled,
        micDevice: typeof raw.micDevice === 'string' ? raw.micDevice : null,
        desktopDevice: typeof raw.desktopDevice === 'string' ? raw.desktopDevice : null,
      }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  save(data: StreamSettingsData): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(data, null, 2))
  }

  patch(p: Partial<StreamSettingsData>): StreamSettingsData {
    const next = { ...this.load(), ...p }
    this.save(next)
    return next
  }

  bumpCounter(): number {
    const next = this.load().counter + 1
    this.patch({ counter: next })
    return next
  }
}
