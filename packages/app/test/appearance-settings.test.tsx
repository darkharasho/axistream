import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
// jsdom's global URL rejects a relative URL against a file: base — the same
// workaround the other stylesheet-reading tests use.
import { URL as NodeURL } from 'node:url'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppearanceSettings } from '../src/renderer/components/AppearanceSettings.js'
import { ACCENTS, SURFACES, ACCENT_STORAGE_KEY, SURFACE_STORAGE_KEY } from '../src/renderer/appearance.js'

/**
 * appearance.test.ts covers the module. This covers the component between that
 * module and the user — the part that can be wired to the right function and
 * still show the wrong thing. It is the only new UI on this branch, and the
 * "which one is selected?" assertions below are exactly what went missing when
 * the accent swatches were given an aria-pressed that nothing styled.
 */

// vitest.config.ts runs jsdom, so <html> and localStorage are real.
beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-axi-accent')
  document.documentElement.removeAttribute('data-axi-theme')
})

const swatches = (c: HTMLElement) => [...c.querySelectorAll<HTMLButtonElement>('.accent-swatch')]
const surfaceButton = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}$`, 'i') })

describe('AppearanceSettings', () => {
  it('mounts the section', () => {
    render(<AppearanceSettings />)
    expect(screen.getByRole('heading', { name: /appearance/i })).toBeTruthy()
  })

  it('renders one swatch per palette entry, each labelled', () => {
    const { container } = render(<AppearanceSettings />)
    const found = swatches(container)
    expect(found).toHaveLength(ACCENTS.length)
    for (const a of ACCENTS) expect(screen.getByRole('button', { name: a.label })).toBeTruthy()
  })

  it('marks exactly the stored accent as pressed', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'violet-purple')
    const { container } = render(<AppearanceSettings />)
    const pressed = swatches(container).filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    const picked = ACCENTS.find((a) => a.id === 'violet-purple')!
    expect(pressed[0].getAttribute('aria-label')).toBe(picked.label)
  })

  it('moves the mark and the root attribute when another accent is picked', () => {
    const { container } = render(<AppearanceSettings />)
    const target = ACCENTS.find((a) => a.id !== 'electric-cyan')!
    fireEvent.click(screen.getByRole('button', { name: target.label }))

    expect(document.documentElement.getAttribute('data-axi-accent')).toBe(target.id)
    const pressed = swatches(container).filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    expect(pressed[0].getAttribute('aria-label')).toBe(target.label)
  })

  // jsdom has no cascade, so "the active swatch is marked" is asserted in two
  // halves: the component sets aria-pressed (above) and the stylesheet reads
  // it. The first half alone was already true while the twelve swatches were
  // indistinguishable on screen — axi.css styles .axi-btn[aria-pressed]
  // nowhere, so the attribute reached no rule at all.
  it('has a stylesheet rule that actually paints the mark', () => {
    const css = readFileSync(new NodeURL('../src/renderer/styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.accent-swatch\[aria-pressed=['"]true['"]\]\s*\{[^}]*box-shadow/)
  })

  it('gives only the active surface the primary treatment', () => {
    localStorage.setItem(SURFACE_STORAGE_KEY, 'glass')
    render(<AppearanceSettings />)
    for (const s of SURFACES) {
      const button = surfaceButton(s.label)
      expect(button.className.includes('axi-btn--primary')).toBe(s.id === 'glass')
      expect(button.getAttribute('aria-pressed')).toBe(String(s.id === 'glass'))
    }
  })

  it('sets data-axi-theme when a repaint surface is chosen', () => {
    render(<AppearanceSettings />)
    fireEvent.click(surfaceButton('Flat'))

    expect(document.documentElement.getAttribute('data-axi-theme')).toBe('flat')
    expect(surfaceButton('Flat').className).toContain('axi-btn--primary')
    expect(surfaceButton('Axi').className).not.toContain('axi-btn--primary')
  })

  // The language is not a theme layered over itself: 'axi' REMOVES the
  // attribute. Asserted through the component because that is where a user
  // reaches it.
  it('removes data-axi-theme again when the language itself is chosen', () => {
    localStorage.setItem(SURFACE_STORAGE_KEY, 'flat')
    render(<AppearanceSettings />)
    fireEvent.click(surfaceButton('Axi'))

    expect(document.documentElement.hasAttribute('data-axi-theme')).toBe(false)
    expect(surfaceButton('Axi').className).toContain('axi-btn--primary')
  })
})
