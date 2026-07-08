import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { MAX_MASKS, type MaskRect } from '../shared/state.js'

export type Privacy = 'public' | 'unlisted' | 'private'
export type MaskStyle = 'box' | 'blur'

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
  gameAudioApps: string[]
  maskStyle: MaskStyle
  discordWebhookUrl: string
  discordMessage: string
  pttEnabled: boolean
  masksVisible: boolean
  pttKeyCode: number
  pttKeyName: string
  pttModifier: '' | 'ctrl' | 'alt' | 'shift' | 'super'
  lastSeenVersion: string
}

export const DEFAULT_SETTINGS: StreamSettingsData = {
  titleTemplate: '{{date}} WvW Raid - {{team}} - {{class}} - {{map}}',
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
  gameAudioApps: [],
  maskStyle: 'box',
  discordWebhookUrl: '',
  discordMessage: '',
  pttEnabled: false,
  masksVisible: true,
  pttKeyCode: 188,
  pttKeyName: 'F18',
  pttModifier: '',
  lastSeenVersion: '',
}

const PRIVACIES: Privacy[] = ['public', 'unlisted', 'private']
const MASK_STYLES: MaskStyle[] = ['box', 'blur']

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

export function sanitizeGameAudioApps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (out.length >= 16) break
    if (typeof v !== 'string') continue
    const name = v.trim()
    if (!name || out.includes(name)) continue
    out.push(name)
  }
  return out
}

export class StreamSettings {
  constructor(private readonly filePath: string) {}

  load(): StreamSettingsData {
    if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StreamSettingsData>
      const r2 = raw as Record<string, unknown>
      const isLegacy = !('gameAudioApps' in raw)
      const gameAudioApps = isLegacy
        ? (r2.gameAudioEnabled === true && typeof r2.gameAudioTarget === 'string' && (r2.gameAudioTarget as string).trim()
            ? [(r2.gameAudioTarget as string).trim()]
            : [])
        : sanitizeGameAudioApps(raw.gameAudioApps)
      const rawDesktopEnabled = typeof raw.desktopEnabled === 'boolean' ? raw.desktopEnabled : DEFAULT_SETTINGS.desktopEnabled
      // Legacy migration: old schema allowed desktopEnabled + gameAudioEnabled both true; force off desktop when migrating a non-empty app list
      const desktopEnabled = isLegacy && gameAudioApps.length > 0 ? false : rawDesktopEnabled
      return {
        titleTemplate: typeof raw.titleTemplate === 'string' ? raw.titleTemplate : DEFAULT_SETTINGS.titleTemplate,
        dateFormat: typeof raw.dateFormat === 'string' && raw.dateFormat ? raw.dateFormat : DEFAULT_SETTINGS.dateFormat,
        privacy: PRIVACIES.includes(raw.privacy as Privacy) ? (raw.privacy as Privacy) : DEFAULT_SETTINGS.privacy,
        counter: Number.isInteger(raw.counter) ? (raw.counter as number) : DEFAULT_SETTINGS.counter,
        streamId: typeof raw.streamId === 'string' ? raw.streamId : null,
        desktopEnabled,
        micEnabled: typeof raw.micEnabled === 'boolean' ? raw.micEnabled : DEFAULT_SETTINGS.micEnabled,
        micDevice: typeof raw.micDevice === 'string' ? raw.micDevice : null,
        desktopDevice: typeof raw.desktopDevice === 'string' ? raw.desktopDevice : null,
        masks: sanitizeMasks(raw.masks),
        preferSoftware: typeof raw.preferSoftware === 'boolean' ? raw.preferSoftware : DEFAULT_SETTINGS.preferSoftware,
        gameAudioApps,
        maskStyle: MASK_STYLES.includes(raw.maskStyle as MaskStyle) ? (raw.maskStyle as MaskStyle) : DEFAULT_SETTINGS.maskStyle,
        discordWebhookUrl: typeof raw.discordWebhookUrl === 'string' ? raw.discordWebhookUrl : DEFAULT_SETTINGS.discordWebhookUrl,
        discordMessage: typeof raw.discordMessage === 'string' ? raw.discordMessage : DEFAULT_SETTINGS.discordMessage,
        pttEnabled: typeof raw.pttEnabled === 'boolean' ? raw.pttEnabled : DEFAULT_SETTINGS.pttEnabled,
        masksVisible: typeof raw.masksVisible === 'boolean' ? raw.masksVisible : DEFAULT_SETTINGS.masksVisible,
        pttKeyCode: Number.isInteger(raw.pttKeyCode) && (raw.pttKeyCode as number) >= 1 && (raw.pttKeyCode as number) <= 767 ? raw.pttKeyCode as number : DEFAULT_SETTINGS.pttKeyCode,
        pttKeyName: typeof raw.pttKeyName === 'string' && raw.pttKeyName ? raw.pttKeyName : DEFAULT_SETTINGS.pttKeyName,
        pttModifier: raw.pttModifier === 'ctrl' || raw.pttModifier === 'alt' || raw.pttModifier === 'shift' || raw.pttModifier === 'super' ? raw.pttModifier : DEFAULT_SETTINGS.pttModifier,
        lastSeenVersion: typeof raw.lastSeenVersion === 'string' ? raw.lastSeenVersion : DEFAULT_SETTINGS.lastSeenVersion,
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
