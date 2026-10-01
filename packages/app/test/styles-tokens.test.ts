import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'

// jsdom's global URL constructor rejects a relative URL against a file: base
// (see test/appearance.test.ts and test/styles-radius.test.ts for the same
// workaround), so this uses the real node:url URL rather than the
// jsdom-polyfilled global.
const PATH = new NodeURL('../src/renderer/styles.css', import.meta.url)

/**
 * The migration's end state: every colour in this stylesheet comes from a
 * token. This guard is the only way to know the sweep actually finished rather
 * than nearly finished, and it keeps the file from regressing afterwards.
 *
 * It matches HEX LITERALS — #rgb, #rrggbb, #rrggbbaa — AND the same digits
 * percent-encoded (%23rrggbb), which is how a hex colour survives inside a CSS
 * url(data:image/svg+xml;...) string. That second form matters: a custom
 * property cannot be interpolated inside an opaque data-URI string, so a
 * literal baked into an inline SVG is a genuine dead end for tokenization, not
 * an oversight — but it still has to show up as a literal, or this guard would
 * pass about it by never looking rather than by exemption.
 *
 * The black-over-video legibility scrims in the .hero-*, .preview-*,
 * .overlay*, .wbtn, .badge, .pill and .chip rules are rgba(0,0,0,…) and
 * rgba(255,255,255,…) functions, and they pass by construction — neither hex
 * form matches a function call. They are legibility devices over arbitrary
 * moving pixels, not surfaces, and --axi-surface-* would be the wrong answer
 * for them. See the spec's "Black over video" section.
 */

// Narrow, explicit exception list. An entry here must be a literal that is
// provably unreachable by tokenization — not one that was merely inconvenient
// to map. Each one documents exactly why. Do not widen this list for anything
// a token could instead name; the whole point of the guard is that this list
// stays short enough to read in one sitting.
const ALLOWED_LITERALS = [
  // The checkmark stroke baked into the checkbox's url(data:image/svg+xml;...)
  // background at .webcam-settings/.quality-body/.wizard-body
  // input[type="checkbox"]:checked. --axi-accent-ink (#06222a) is the right
  // colour for it — ink on an accent fill — but a CSS custom property cannot
  // be interpolated inside a data-URI string, which the CSS engine treats as
  // an opaque value, so it cannot become var(--axi-accent-ink) and has to stay
  // a literal.
  '%2306222a',
]

describe('styles.css has no colour literals', () => {
  it('contains no hex colour anywhere', () => {
    const css = readFileSync(PATH, 'utf8')
    const offenders = css
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => {
        const found = [
          ...(line.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
          ...(line.match(/%23[0-9a-fA-F]{3,8}\b/g) ?? []),
        ]
        return found.some((literal) => !ALLOWED_LITERALS.includes(literal))
      })
      .map(([n, line]) => `${n}: ${line.trim()}`)
    expect(offenders).toEqual([])
  })

  it('reaches for tokens instead', () => {
    const css = readFileSync(PATH, 'utf8')
    // A sheet that passed the first assertion by having no colours at all
    // would not be a migration.
    expect(css.match(/var\(--axi-/g)!.length).toBeGreaterThan(50)
  })

  it('keeps the black-over-video scrims, which are legibility and not paint', () => {
    const css = readFileSync(PATH, 'utf8')
    expect(css).toMatch(/rgba\(0,\s*0,\s*0,/)
  })

  it('keeps the allowlist narrow and names only genuinely unreachable literals', () => {
    const css = readFileSync(PATH, 'utf8')
    for (const literal of ALLOWED_LITERALS) {
      // Every allowlisted literal must actually appear inside a data: URI —
      // otherwise it is not an exception to the token rule, it is a literal
      // that was never swept and got exempted by mistake.
      const line = css.split('\n').find((l) => l.includes(literal))
      expect(line, `${literal} is allowlisted but not present in styles.css`).toBeDefined()
      expect(line, `${literal} is allowlisted but not inside a data: URI`).toMatch(/url\(["']?data:/)
    }
  })
})
