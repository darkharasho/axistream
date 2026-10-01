import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ACCENTS,
  SURFACES,
  DEFAULT_ACCENT_ID,
  DEFAULT_SURFACE_ID,
  ACCENT_STORAGE_KEY,
  SURFACE_STORAGE_KEY,
  resolveAccentId,
  resolveSurfaceId,
  readAccent,
  readSurface,
  applyAccent,
  applySurface,
  bootAppearance,
} from '../src/renderer/appearance.js'

// vitest.config.ts runs jsdom, so <html> and localStorage are real.
beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-axi-accent')
  document.documentElement.removeAttribute('data-axi-theme')
  document.documentElement.classList.remove('theme-transitioning')
})

describe('the palette', () => {
  it('is the design language\'s, with electric-cyan present', () => {
    expect(ACCENTS.length).toBeGreaterThanOrEqual(12)
    const cyan = ACCENTS.find((a) => a.id === 'electric-cyan')
    expect(cyan).toBeDefined()
    expect(cyan!.hex).toBe('#22d3ee')
  })

  // The whole point of adding a twelfth accent: the app's identity colour
  // survives the migration, so a first launch looks unchanged.
  it('defaults to electric-cyan, axistream\'s identity colour', () => {
    expect(DEFAULT_ACCENT_ID).toBe('electric-cyan')
  })

  it('offers the three surfaces in order, defaulting to the language', () => {
    expect(SURFACES.map((s) => s.id)).toEqual(['axi', 'flat', 'glass'])
    expect(SURFACES.map((s) => s.label)).toEqual(['Axi', 'Flat', 'Glass'])
    expect(DEFAULT_SURFACE_ID).toBe('axi')
  })
})

// Review Focus 2
describe('resolving stored ids', () => {
  it('passes through ids it knows', () => {
    expect(resolveAccentId('axi-gold')).toBe('axi-gold')
    expect(resolveSurfaceId('flat')).toBe('flat')
    expect(resolveSurfaceId('glass')).toBe('glass')
    expect(resolveSurfaceId('axi')).toBe('axi')
  })

  it('falls back for ids from a future or downgraded version', () => {
    expect(resolveAccentId('ultraviolet')).toBe(DEFAULT_ACCENT_ID)
    expect(resolveSurfaceId('frosted')).toBe(DEFAULT_SURFACE_ID)
  })

  it('falls back for empty and absent values', () => {
    expect(resolveAccentId(null)).toBe(DEFAULT_ACCENT_ID)
    expect(resolveAccentId(undefined)).toBe(DEFAULT_ACCENT_ID)
    expect(resolveAccentId('')).toBe(DEFAULT_ACCENT_ID)
    expect(resolveSurfaceId(null)).toBe(DEFAULT_SURFACE_ID)
    expect(resolveSurfaceId('')).toBe(DEFAULT_SURFACE_ID)
  })

  it('does not reach the prototype chain', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'valueOf']) {
      expect(resolveAccentId(key)).toBe(DEFAULT_ACCENT_ID)
      expect(resolveSurfaceId(key)).toBe(DEFAULT_SURFACE_ID)
    }
  })
})

describe('applying', () => {
  it('puts the accent on <html> and remembers it', () => {
    expect(applyAccent('axi-gold')).toBe('axi-gold')
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('axi-gold')
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('axi-gold')
  })

  it('puts a surface theme on <html> and remembers it', () => {
    expect(applySurface('glass')).toBe('glass')
    expect(document.documentElement.getAttribute('data-axi-theme')).toBe('glass')
    expect(localStorage.getItem(SURFACE_STORAGE_KEY)).toBe('glass')
  })

  it('treats flat as a theme like any other', () => {
    expect(applySurface('flat')).toBe('flat')
    expect(document.documentElement.getAttribute('data-axi-theme')).toBe('flat')
  })

  it('removes the attribute for axi rather than naming the language', () => {
    applySurface('glass')
    expect(applySurface('axi')).toBe('axi')
    expect(document.documentElement.hasAttribute('data-axi-theme')).toBe(false)
    expect(localStorage.getItem(SURFACE_STORAGE_KEY)).toBe('axi')
  })

  it('crossfades, sharing one timer between accent and surface', () => {
    vi.useFakeTimers()
    applyAccent('axi-gold')
    vi.advanceTimersByTime(300)
    applySurface('glass')
    vi.advanceTimersByTime(300)
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(true)
    vi.advanceTimersByTime(250)
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false)
    vi.useRealTimers()
  })
})

// Review Focus 3
describe('when storage is unavailable', () => {
  it('still reads defaults rather than throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled by policy')
    })
    expect(readAccent()).toBe(DEFAULT_ACCENT_ID)
    expect(readSurface()).toBe(DEFAULT_SURFACE_ID)
    vi.restoreAllMocks()
  })

  it('still applies the appearance for the life of the session', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(applyAccent('axi-gold')).toBe('axi-gold')
    expect(applySurface('glass')).toBe('glass')
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('axi-gold')
    expect(document.documentElement.getAttribute('data-axi-theme')).toBe('glass')
    vi.restoreAllMocks()
  })
})

// Review Focus 5
describe('bootAppearance', () => {
  it('sets the accent before anything renders, so the first paint is correct', () => {
    bootAppearance()
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe(DEFAULT_ACCENT_ID)
    // Default surface is the language, which is the absence of the attribute.
    expect(document.documentElement.hasAttribute('data-axi-theme')).toBe(false)
  })

  it('restores a remembered appearance', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'rose-pink')
    localStorage.setItem(SURFACE_STORAGE_KEY, 'glass')
    bootAppearance()
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('rose-pink')
    expect(document.documentElement.getAttribute('data-axi-theme')).toBe('glass')
  })

  it('does not crossfade the first paint, which would flash against an unthemed page', () => {
    bootAppearance()
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false)
  })
})
