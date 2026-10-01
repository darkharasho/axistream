import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'

// jsdom's global URL constructor rejects a relative URL against a file: base
// (see test/appearance.test.ts and test/styles-tokens.test.ts for the same
// workaround), so this uses the real node:url URL rather than the
// jsdom-polyfilled global.
const DIR = new NodeURL('../src/renderer/components/', import.meta.url)

/**
 * styles-tokens.test.ts guards styles.css. A stylesheet cannot reach an
 * inline `style={{}}` prop, so that guard says nothing about the colours a
 * component sets on itself at render time — this is the same rule applied
 * where the other one cannot see, scanning every component file instead of
 * the stylesheet. It intentionally does not re-scan styles.css; that
 * coverage already exists and duplicating it here would just be two guards
 * disagreeing eventually.
 *
 * Same literal classes as the stylesheet guard: hex (#rgb/#rrggbb/#rrggbbaa),
 * percent-encoded hex, non-greyscale rgb()/rgba(), hsl()/hsla(), and CSS
 * Level 3 named colours. A greyscale rgba() (equal R/G/B) is still allowed
 * through, for the same reason as the stylesheet: a tint over live video is
 * legibility, not paint, and no token can express "percent of whatever is
 * already there".
 *
 * The one allowed hit is the accent swatch in AppearanceSettings.tsx: a
 * swatch's whole job is to show the literal colour it offers, and that
 * value is palette data (`a.hex`, read from the design language's
 * accents.json) rather than a hand-picked literal — there is nothing to
 * tokenize because the whole point is that it varies per row.
 */

const ALLOWED_LITERALS: string[] = [
  // (none at present — kept as a named, narrow list rather than an inline
  // regex tweak so a future addition has to be justified in writing here,
  // the same discipline styles-tokens.test.ts uses for its own allowlist)
]

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
// Matched only as a value position (after `:`, `,`, `(` and optional
// whitespace, never followed by `-`), the same as styles-tokens.test.ts, so
// identifiers and prose containing a colour word by coincidence don't trip
// it. JSX/TS source is more exposed to this than CSS: e.g. "color" itself is
// a property NAME, not a value, and is unaffected by this pattern.
const NAMED_COLOR_RE = new RegExp(`[:,(]\\s*(${NAMED_COLORS.join('|')})\\b(?!-)`, 'gi')

/** True iff an rgb()/rgba() call's first three channels are not all equal —
 *  i.e. it is a hue, not a grey. Same rule as styles-tokens.test.ts. */
function isNonGreyscaleRgba(call: string): boolean {
  const m = call.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!m) return false
  const [, r, g, b] = m
  return !(r === g && g === b)
}

function offenders(src: string): string[] {
  const lines = src.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // The accent swatch shows the colour it selects, which is palette data
    // (a.hex) rather than a literal — see AppearanceSettings.tsx's render of
    // ACCENTS. Nothing else on this line class is exempt.
    if (line.includes('a.hex')) continue
    const found = [
      ...(line.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(line.match(/%23[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(line.match(/rgba?\([^)]*\)/gi) ?? []).filter(isNonGreyscaleRgba),
      ...(line.match(/hsla?\([^)]*\)/gi) ?? []),
      ...(line.match(NAMED_COLOR_RE) ?? []).map((m) => m.replace(/^[:,(]\s*/, '')),
    ]
    if (found.some((literal) => !ALLOWED_LITERALS.includes(literal))) {
      out.push(`${i + 1}: ${line.trim()}`)
    }
  }
  return out
}

describe('components carry no colour literals', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx'))

  it.each(files)('%s uses tokens, not raw colour, in its own source', (file) => {
    const src = readFileSync(new NodeURL(file, DIR), 'utf8')
    expect(offenders(src)).toEqual([])
  })

  it('keeps the accent swatch as the one exempted literal, and nothing else', () => {
    const src = readFileSync(new NodeURL('AppearanceSettings.tsx', DIR), 'utf8')
    expect(src).toMatch(/style=\{\{\s*background:\s*a\.hex\s*\}\}/)
  })
})
