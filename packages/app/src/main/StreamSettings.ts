import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { MAX_MASKS, type MaskRect } from '../shared/state.js'

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
  masks: MaskRect[]
  preferSoftware: boolean
  gameAudioEnabled: boolean
  gameAudioTarget: string | null
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
  masks: [],
  preferSoftware: false,
  gameAudioEnabled: false,
  gameAudioTarget: null,
}

const PRIVACIES: Privacy[] = ['public', 'unlisted', 'private']

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function sanitizeMasks(raw: unknown): MaskRect[] {
  if (!Array.isArray(raw)) return []
  const out: MaskRect[] = []
  for (const m of raw) {
    if (out.length >= MAX_MASKS) break
    if (typeof m !== 'object' || m === null) continue
    const { id, x, y, w, h } = m as Record<string, unknown>
    if (typeof id !== 'string' || !id) continue
    if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) continue
    out.push({ id, x: clamp(x as number, 0, 1), y: clamp(y as number, 0, 1), w: clamp(w as number, 0.01, 1), h: clamp(h as number, 0.01, 1) })
  }
  return out
}

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
        masks: sanitizeMasks(raw.masks),
        preferSoftware: typeof raw.preferSoftware === 'boolean' ? raw.preferSoftware : DEFAULT_SETTINGS.preferSoftware,
        gameAudioEnabled: typeof raw.gameAudioEnabled === 'boolean' ? raw.gameAudioEnabled : DEFAULT_SETTINGS.gameAudioEnabled,
        gameAudioTarget: typeof raw.gameAudioTarget === 'string' ? raw.gameAudioTarget : null,
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
