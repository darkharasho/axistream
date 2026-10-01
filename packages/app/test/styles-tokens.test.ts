import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'

// jsdom's global URL constructor rejects a relative URL against a file: base
// (see test/appearance.test.ts and test/styles-radius.test.ts for the same
// workaround), so this uses the real node:url URL rather than the
// jsdom-polyfilled global.
const PATH = new NodeURL('../src/renderer/styles.css', import.meta.url)
// The one other file in the renderer's paint path. components-tokens.test.ts
// owns every .ts/.tsx under src/renderer/ and this file owns the stylesheet,
// which left index.html seen by neither: a <style> block, a bgcolor or an
// inline style attribute there would pass both guards silently. It is
// colour-free today, so this closes a seam rather than fixing a leak.
const INDEX_PATH = new NodeURL('../index.html', import.meta.url)

/**
 * The migration's end state: every colour in this stylesheet comes from a
 * token. This guard is the only way to know the sweep actually finished
 * rather than nearly finished, and it keeps the file from regressing
 * afterwards.
 *
 * What it rejects, precisely:
 *  - A hex literal: #rgb, #rrggbb, #rrggbbaa.
 *  - The same digits percent-encoded (%23rrggbb) — how a hex colour survives
 *    inside a CSS url(data:image/svg+xml;...) string, where a custom
 *    property cannot be interpolated because the string is opaque to the CSS
 *    engine. It still has to show up as a literal here, or this guard would
 *    pass about it by never looking rather than by exemption.
 *  - rgb()/rgba() whose three colour channels are NOT all equal. A
 *    non-greyscale rgba is a hue, and a hue belongs in a token — that was
 *    exactly how a round of this sweep tokenized `color:` on eight warn/
 *    danger selectors while leaving their own sibling `background`/
 *    `border-color` as the old rgba literal, producing a selector that
 *    clashed with itself on first launch. This guard would have caught that.
 *  - hsl()/hsla() of any kind, and any CSS Level 3 named colour (red, black,
 *    white, ...) used as a value — neither currently appears in the file;
 *    this is a latent trip-wire, not evidence either was ever used.
 *
 * What it deliberately still lets through, and why that is not a gap:
 *  - An rgb()/rgba() whose three channels ARE all equal — rgba(0,0,0,.4),
 *    rgba(255,255,255,.08), rgba(13,13,13,.5) — because that is a grey, and
 *    greyscale alpha over arbitrary video is exactly what the black-over-
 *    video legibility scrims in .hero-*, .preview-*, .overlay*, .wbtn,
 *    .badge, .pill and .chip need: a tint of the pixels already there, not a
 *    hue of their own. --axi-surface-* would be the wrong answer for them.
 *    See the spec's "Black over video" section.
 *  - `transparent` and `currentcolor`, which name no colour of their own and
 *    so have nothing to tokenize.
 *  - Comments. Named-colour and hsl() detection runs against a copy of the
 *    file with every /* ... *\/ block blanked out (newlines kept, so line
 *    numbers still line up) — prose like "Axi white + accent" or "instead of
 *    black" is English, not CSS, and flagging it would make this guard noisy
 *    enough to stop being read. Hex/percent-hex/rgba detection runs against
 *    the raw text, because confirmed by inspection no comment in this file
 *    currently contains anything those patterns would match.
 */

// Narrow, explicit exception list. An entry here must be a literal that is
// provably unreachable by tokenization, or for which no token in this
// design language's palette exists to reach for — not one that was merely
// inconvenient to map. Each one documents exactly why. Do not widen this
// list for anything a token could instead name; the whole point of the
// guard is that this list stays short enough to read in one sitting.
const ALLOWED_LITERALS = [
  // The checkmark stroke baked into the checkbox's url(data:image/svg+xml;...)
  // background at .webcam-settings/.quality-body/.wizard-body
  // input[type="checkbox"]:checked. --axi-accent-ink (#06222a) is the right
  // colour for it — ink on an accent fill — but a CSS custom property cannot
  // be interpolated inside a data-URI string, which the CSS engine treats as
  // an opaque value, so it cannot become var(--axi-accent-ink) and has to stay
  // a literal.
  '%2306222a',
  // .hero.setup::before / .hero::after's cinematic ambient wash (two radial
  // gradients, each used twice). This is bespoke decoration with no status or
  // surface meaning — not a hue this design language names. The one "cool
  // ink" it ships, --axi-meta (#4ec3ff), is reserved for meta text/chips and
  // explicitly documented as "never a status" (axi-design/src/tokens.css);
  // reaching for it here would misuse a semantically scoped token for an
  // unrelated purpose, and there is no token at all for the second (purple)
  // half of the wash. Prefer tokenizing was the rule; there is nothing here
  // to tokenize with.
  'rgba(120,180,255,.26)',
  'rgba(200,120,255,.2)',
]

/** Blanks out /* ... *\/ comments (newlines kept, so line numbers still
 *  line up) so prose mentioning a colour by name doesn't trip the
 *  named-colour/hsl scan. Hex/rgba detection intentionally does NOT use
 *  this — see the docstring above. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

// CSS Color Module Level 3 named colours. `transparent` and `currentcolor`
// are deliberately excluded — neither names an actual colour to tokenize.
const NAMED_COLORS = [
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow',
  'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell',
  'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white',
  'whitesmoke', 'yellow', 'yellowgreen',
]
// Matched only as a CSS value (immediately after `:`, `,`, `(` and optional
// whitespace, never followed by `-`), so "white-space" and prose like "Axi
// white" don't collide with it even on the raw (non-comment-stripped) text.
const NAMED_COLOR_RE = new RegExp(`[:,(]\\s*(${NAMED_COLORS.join('|')})\\b(?!-)`, 'gi')

/** True iff an rgb()/rgba() call's first three channels are not all equal —
 *  i.e. it is a hue, not a grey. */
function isNonGreyscaleRgba(call: string): boolean {
  const m = call.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!m) return false
  const [, r, g, b] = m
  return !(r === g && g === b)
}

function offenders(css: string): string[] {
  const rawLines = css.split('\n')
  const scanLines = withoutComments(css).split('\n')
  const out: string[] = []
  for (let i = 0; i < rawLines.length; i++) {
    // Hex/percent-hex/rgba are scanned on the raw line (see docstring: no
    // comment currently contains one). Named-colour/hsl are scanned on the
    // comment-stripped line so prose can't trip them.
    const found = [
      ...(rawLines[i].match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(rawLines[i].match(/%23[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(rawLines[i].match(/rgba?\([^)]*\)/gi) ?? []).filter(isNonGreyscaleRgba),
      ...(scanLines[i].match(/hsla?\([^)]*\)/gi) ?? []),
      ...(scanLines[i].match(NAMED_COLOR_RE) ?? []).map((m) => m.replace(/^[:,(]\s*/, '')),
    ]
    if (found.some((literal) => !ALLOWED_LITERALS.includes(literal))) {
      out.push(`${i + 1}: ${rawLines[i].trim()}`)
    }
  }
  return out
}

describe('styles.css has no colour literals', () => {
  it('contains no hex, non-greyscale rgb()/rgba(), hsl()/hsla(), or named colour anywhere', () => {
    const css = readFileSync(PATH, 'utf8')
    expect(offenders(css)).toEqual([])
  })

  it('covers index.html too, which neither guard used to see', () => {
    expect(offenders(readFileSync(INDEX_PATH, 'utf8'))).toEqual([])
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
      const line = css.split('\n').find((l) => l.includes(literal))
      expect(line, `${literal} is allowlisted but not present in styles.css`).toBeDefined()
      // Every allowlisted literal is either baked into a data: URI (the
      // checkbox tick) or part of the one bespoke decorative wash that has
      // no corresponding token (the hero gradients) — never an ordinary
      // literal that was simply never swept.
      const isDataUri = /url\(["']?data:/.test(line!)
      const isHeroWash = line!.includes('radial-gradient')
      expect(isDataUri || isHeroWash, `${literal} is allowlisted but isn't inside a data: URI or the hero gradient wash`).toBe(true)
    }
  })
})
