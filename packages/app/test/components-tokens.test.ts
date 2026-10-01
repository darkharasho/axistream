import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'

// jsdom's global URL constructor rejects a relative URL against a file: base
// (see test/appearance.test.ts and test/styles-tokens.test.ts for the same
// workaround), so this uses the real node:url URL rather than the
// jsdom-polyfilled global.
const RENDERER_DIR = new NodeURL('../src/renderer/', import.meta.url)

/**
 * styles-tokens.test.ts guards styles.css. A stylesheet cannot reach an
 * inline `style={{}}` prop, so that guard says nothing about the colours a
 * component sets on itself at render time — this is the same rule applied
 * where the other one cannot see.
 *
 * Scope is every `.ts`/`.tsx` file under `src/renderer/`, walked recursively
 * — not just `src/renderer/components/`. `App.tsx` and the renderer's other
 * top-level modules (`appearance.ts`, `store.ts`, `toasts.ts`,
 * `cover-transform.ts`, `device-options.ts`, `use-modal-keys.ts`,
 * `main.tsx`) are just as capable of carrying an inline colour literal as
 * anything in `components/`, and there is no reason the guard should stop at
 * a directory boundary that isn't a real boundary for this question. It
 * stays confined to `src/renderer/` rather than the whole app on purpose:
 * `src/main/MaskController.ts`'s `MASK_COLOR` (an OBS ABGR bitmask, not a
 * CSS colour — no leading `#`, so it wouldn't trip this guard's patterns
 * anyway) and `src/main/index.ts`'s `backgroundColor: '#00000000'` (a
 * BrowserWindow constructor option, not a DOM style) are legitimate,
 * unrelated uses outside the renderer that this guard has no business
 * seeing. It intentionally does not re-scan styles.css; that coverage
 * already exists in styles-tokens.test.ts and duplicating it here would
 * just be two guards disagreeing eventually.
 *
 * Same literal classes as the stylesheet guard: hex (#rgb/#rrggbb/#rrggbbaa),
 * percent-encoded hex, non-greyscale rgb()/rgba(), hsl()/hsla(), and CSS
 * Level 3 named colours. A greyscale rgba() (equal R/G/B) is still allowed
 * through, for the same reason as the stylesheet: a tint over live video is
 * legibility, not paint, and no token can express "percent of whatever is
 * already there".
 *
 * Comments are stripped before every one of those checks — not just the
 * named-colour/hsl scan the way styles-tokens.test.ts does it. That sibling
 * keeps hex/percent-hex/rgba on raw text because it confirmed no comment in
 * styles.css contains one; the same check here found the opposite:
 * appearance.ts's doc comment on DEFAULT_ACCENT_ID narrates the literal
 * hex AxiStream shipped with before this migration ("AxiStream was built
 * around #22d3ee..."), which is exactly the kind of historical prose a
 * doc comment is for and not a colour that needs a token. TS/TSX source is
 * simply chattier than CSS about *why*, so this guard strips comments
 * everywhere the stylesheet guard only needed to in principle.
 *
 * The one allowed value is the accent swatch in AppearanceSettings.tsx:
 * `style={{ background: a.hex }}`. A swatch's whole job is to show the
 * literal colour it offers, and that value is palette data (`a.hex`, read
 * per-row from the design language's accents.json) rather than a
 * hand-picked literal — there is nothing to tokenize because the whole
 * point is that it varies per row. The exemption below removes only the
 * `a.hex` expression itself before scanning, not the rest of its line —
 * a real colour literal sitting on the same line (e.g. a future
 * `style={{ background: a.hex, border: '#fff' }}`) must still be caught.
 */

// Narrow, explicit exception list, same discipline as styles-tokens.test.ts:
// an entry here must be a literal that is provably unreachable by
// tokenization, not one that was merely inconvenient to map. Locked empty by
// the test below — nothing here today, and an addition must come with its
// own justification and un-skip that test.
const ALLOWED_LITERALS: string[] = []

// The accent swatch's one legitimate literal-shaped value. Stripped from the
// text before scanning (not matched as a literal and not used to skip a
// whole line), so anything else on its line is still scanned normally.
const EXEMPT_VALUE_RE = /\ba\.hex\b/g

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
// a property NAME, not a value, and is unaffected by this pattern. Like its
// sibling, this does not catch a bare JSX attribute value such as
// `fill="red"` (preceded by `"`, not `:`/`,`/`(`) — inherited from the Task 5
// guard's own anchoring on purpose: fixing that gap in one guard and not the
// other would create exactly the idiom divergence this guard exists to
// avoid, so if it's ever fixed, it's fixed in both at once.
const NAMED_COLOR_RE = new RegExp(`[:,(]\\s*(${NAMED_COLORS.join('|')})\\b(?!-)`, 'gi')

/** True iff an rgb()/rgba() call's first three channels are not all equal —
 *  i.e. it is a hue, not a grey. Same rule as styles-tokens.test.ts. */
function isNonGreyscaleRgba(call: string): boolean {
  const m = call.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!m) return false
  const [, r, g, b] = m
  return !(r === g && g === b)
}

/** Blanks out /* ... *\/ comments (newlines kept, so line numbers still line
 *  up), identical in approach to styles-tokens.test.ts's withoutComments. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

function offenders(src: string): string[] {
  const reportLines = src.split('\n')
  // The exemption removes only the `a.hex` expression itself — a value-level
  // strip, not a line-level skip — so a real literal sharing its line is
  // still caught below.
  const exempted = src.replace(EXEMPT_VALUE_RE, '')
  // Every check runs on the comment-stripped text — see the docstring above
  // for why this guard diverges from styles-tokens.test.ts on exactly this
  // point.
  const scanLines = withoutComments(exempted).split('\n')
  const out: string[] = []
  for (let i = 0; i < scanLines.length; i++) {
    const found = [
      ...(scanLines[i].match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(scanLines[i].match(/%23[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(scanLines[i].match(/rgba?\([^)]*\)/gi) ?? []).filter(isNonGreyscaleRgba),
      ...(scanLines[i].match(/hsla?\([^)]*\)/gi) ?? []),
      ...(scanLines[i].match(NAMED_COLOR_RE) ?? []).map((m) => m.replace(/^[:,(]\s*/, '')),
    ]
    if (found.some((literal) => !ALLOWED_LITERALS.includes(literal))) {
      out.push(`${i + 1}: ${reportLines[i].trim()}`)
    }
  }
  return out
}

/** Every .ts/.tsx file under `dir`, walked recursively, as paths relative to
 *  `RENDERER_DIR` (so test names and file reads both work from one value). */
function listSourceFiles(dir: NodeURL, prefix = ''): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const rel = prefix + entry.name
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(new NodeURL(entry.name + '/', dir), rel + '/'))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(rel)
    }
  }
  return out
}

describe('the renderer carries no colour literals outside styles.css', () => {
  const files = listSourceFiles(RENDERER_DIR)

  it.each(files)('%s uses tokens, not raw colour, in its own source', (file) => {
    const src = readFileSync(new NodeURL(file, RENDERER_DIR), 'utf8')
    expect(offenders(src)).toEqual([])
  })

  it('keeps the accent swatch as the one exempted value, and nothing else', () => {
    const src = readFileSync(new NodeURL('components/AppearanceSettings.tsx', RENDERER_DIR), 'utf8')
    expect(src).toMatch(/style=\{\{\s*background:\s*a\.hex\s*\}\}/)
  })

  it('keeps the allowlist locked empty — an addition must be deliberate and justified here', () => {
    expect(ALLOWED_LITERALS).toEqual([])
    // Future-proofing in the sibling guard's idiom: if this list ever gains
    // an entry, each one must actually appear in some scanned file (the same
    // check styles-tokens.test.ts performs), so nothing can be allowlisted
    // without the literal it's excusing still being visible for review.
    for (const literal of ALLOWED_LITERALS) {
      const present = files.some((f) => readFileSync(new NodeURL(f, RENDERER_DIR), 'utf8').includes(literal))
      expect(present, `${literal} is allowlisted but not present in any scanned file`).toBe(true)
    }
  })
})
