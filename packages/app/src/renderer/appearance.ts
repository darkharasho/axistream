import accentsJson from '@axiapps/axi-design/accents.json'

export type AccentDefinition = { id: string; label: string; hex: string }

/** The palette is the design language's, read from the package rather than
 *  restated here — a copy would drift the first time an accent is added. */
export const ACCENTS: AccentDefinition[] = accentsJson as AccentDefinition[]

/**
 * AxiStream was built around #22d3ee, and `electric-cyan` exists in the palette
 * precisely so that colour survives this migration. The app therefore looks
 * essentially unchanged out of the box — but every cyan in it now follows the
 * picker instead of being welded into the stylesheet.
 */
export const DEFAULT_ACCENT_ID = 'electric-cyan'

/**
 * The surfaces the design language paints. 'axi' is the language itself, drawn
 * with no `data-axi-theme` at all. 'flat' and 'glass' are repaints of it
 * shipped as `@axiapps/axi-design/themes/<id>.css`.
 */
export type SurfaceId = 'axi' | 'flat' | 'glass'

export const SURFACES: { id: SurfaceId; label: string }[] = [
  { id: 'axi', label: 'Axi' },
  { id: 'flat', label: 'Flat' },
  { id: 'glass', label: 'Glass' }
]

/** The language itself is the default, as in every other axi app. */
export const DEFAULT_SURFACE_ID: SurfaceId = 'axi'

// Renderer-side rather than in the main process: appearance is renderer-only,
// and a synchronous read before the first render is what keeps the window from
// painting a default and visibly flipping once IPC answers.
export const ACCENT_STORAGE_KEY = 'axistream.accent'
export const SURFACE_STORAGE_KEY = 'axistream.surface'

/** Always returns an id that exists in ACCENTS. Membership is tested against
 *  the array rather than an object, so inherited property names are unknown
 *  values like any other. AxiStream has never persisted an accent before this,
 *  so there is no legacy vocabulary to translate. */
export function resolveAccentId(id?: string | null): string {
  return ACCENTS.some((a) => a.id === id) ? (id as string) : DEFAULT_ACCENT_ID
}

/** Always returns one of the three surface ids, on the same terms. */
export function resolveSurfaceId(id?: string | null): SurfaceId {
  return SURFACES.some((s) => s.id === id) ? (id as SurfaceId) : DEFAULT_SURFACE_ID
}

let transitionTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Holds the crossfade class on <html> for the length of the transition so the
 * whole window changes together instead of each element snapping on its own
 * next repaint. Shared by the accent and the surface: changing both at once
 * should still be one fade, so the timer is deliberately not per-attribute.
 */
function crossfade(root: Element): void {
  root.classList.add('theme-transitioning')
  if (transitionTimer) clearTimeout(transitionTimer)
  transitionTimer = setTimeout(() => {
    root.classList.remove('theme-transitioning')
    transitionTimer = null
  }, 500)
}

export function readAccent(): string {
  try {
    return resolveAccentId(localStorage.getItem(ACCENT_STORAGE_KEY))
  } catch {
    return DEFAULT_ACCENT_ID
  }
}

export function readSurface(): SurfaceId {
  try {
    return resolveSurfaceId(localStorage.getItem(SURFACE_STORAGE_KEY))
  } catch {
    return DEFAULT_SURFACE_ID
  }
}

/** Puts an accent on <html>, where accents.css's [data-axi-accent] rules hang,
 *  and remembers it. */
export function applyAccent(id?: string | null, opts: { transition?: boolean } = {}): string {
  const resolved = resolveAccentId(id)
  const root = document.documentElement

  if (opts.transition !== false) crossfade(root)

  root.setAttribute('data-axi-accent', resolved)
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, resolved)
  } catch {
    // Storage disabled: the accent still applies for the life of the session,
    // only the memory of it is lost.
  }
  return resolved
}

/**
 * Puts a surface on <html> and remembers it. 'axi' removes the attribute rather
 * than naming itself: the language is not a theme layered over itself, and
 * axi-design's own rule is that removing `data-axi-theme` leaves you back on it
 * with no other change.
 */
export function applySurface(id?: string | null, opts: { transition?: boolean } = {}): SurfaceId {
  const resolved = resolveSurfaceId(id)
  const root = document.documentElement

  if (opts.transition !== false) crossfade(root)

  if (resolved === 'axi') root.removeAttribute('data-axi-theme')
  else root.setAttribute('data-axi-theme', resolved)

  try {
    localStorage.setItem(SURFACE_STORAGE_KEY, resolved)
  } catch {
    // Same bargain as the accent: applied now, just not remembered.
  }
  return resolved
}

/**
 * Called at module scope in main.tsx, before createRoot. No crossfade: there is
 * nothing to fade from on the first paint, and transitioning against an
 * unthemed page is visible as a flash.
 */
export function bootAppearance(): void {
  applyAccent(readAccent(), { transition: false })
  applySurface(readSurface(), { transition: false })
}
