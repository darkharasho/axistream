import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'

// jsdom's global URL constructor rejects a relative URL against a file: base
// (see test/appearance.test.ts for the same workaround), so this uses the
// real node:url URL rather than the jsdom-polyfilled global.
const css = readFileSync(new NodeURL('../src/renderer/styles.css', import.meta.url), 'utf8')

/**
 * The window radius is a token, so it is 16px under glass and 6px under flat.
 * Seven values across five selectors have to follow it, or the composited
 * <video> corners disagree with the frame in two of the three surfaces.
 *
 * No test here can see a composited layer. What these assertions can do is
 * prove no bare 10px radius survived, which is the failure mode that would
 * otherwise only show up on real hardware.
 */
describe('the window radius follows the surface', () => {
  const RADIUS_SELECTORS = ['#root', '.app', '.hero', '.preview-backdrop', '.preview-video']

  function ruleFor(selector: string): string {
    const line = css.split('\n').find((l) => l.trimStart().startsWith(selector + ' '))
    expect(line, `no rule found for ${selector}`).toBeDefined()
    return line!
  }

  it.each(RADIUS_SELECTORS)('%s rounds with var(--axi-radius), not a literal', (selector) => {
    const rule = ruleFor(selector)
    expect(rule).toMatch(/border(-[a-z-]+)?-radius:[^;]*var\(--axi-radius\)/)
    expect(rule).not.toMatch(/border(-[a-z-]+)?-radius:[^;]*\d+px/)
  })

  it('clips the composited video layer to the same token', () => {
    // clip-path is what actually reaches a zero-copy hardware overlay; a
    // border-radius on an ancestor does not.
    expect(ruleFor('.app')).toMatch(/clip-path:\s*inset\(0 round var\(--axi-radius\)\)/)
  })

  it('leaves no bare 10px radius on the frame/shell selectors', () => {
    // Scoped to the five selectors this task owns, not the whole sheet: other
    // controls (.btn.action, .toast, .sel-list, .keypicker-menulist, ...)
    // carry their own unrelated 10px radius and are out of this task's
    // worklist. --axi-radius-sm is 0 on the default 'axi' surface, so forcing
    // those onto the token would square off buttons/menus on first launch —
    // a visible regression the "look essentially unchanged" constraint rules
    // out. Converting them is a later task's job, not this one's.
    const offenders = RADIUS_SELECTORS
      .map((selector) => [selector, ruleFor(selector)] as const)
      .filter(([, rule]) => /border(-[a-z-]+)?-radius:[^;]*\b10px\b/.test(rule))
    expect(offenders).toEqual([])
  })
})

describe('the shell paints itself from tokens', () => {
  it('gives .app the ground colour and the ground image', () => {
    const rule = css.split('\n').find((l) => l.trimStart().startsWith('.app '))!
    expect(rule).toMatch(/background-color:\s*var\(--axi-ground\)/)
    // Glass's three radial gradients arrive through this token.
    expect(rule).toMatch(/background-image:\s*var\(--axi-ground-image\)/)
  })

  it('no longer carries a .sidebar rule, which the rail replaces', () => {
    expect(css).not.toMatch(/^\.sidebar\s*\{/m)
  })
})
