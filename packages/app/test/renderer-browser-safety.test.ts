import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// vitest runs with cwd = packages/app; import.meta.url is not a file URL under
// the jsdom environment this suite shares.
const pkg = process.cwd()
const roots = [join(pkg, 'src/renderer'), join(pkg, 'src/shared')]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

/** Any import of the bare '@axistream/capture' barrel that is not `import type`.
 *  Subpath imports ('@axistream/capture/encoder-entries') are fine. */
const BARE_BARREL = /(^|\n)\s*import\s+(?!type\s)([\s\S]*?)\s+from\s+'@axistream\/capture'/g

const WHY = [
  "packages/capture's '.' barrel re-exports Node-only modules (obs-sidecar,",
  'capture-config, the owned-OBS runtimes) that reach for node:fs, node:child_process',
  'and koffi. Renderer and shared code ends up in the browser bundle, so a value',
  'import of the barrel makes rollup pull that whole Node graph in and `npm run build`',
  'dies with `"readFileSync" is not exported by "__vite-browser-external"`. Neither',
  'the unit suites (vitest resolves in Node) nor `tsc --noEmit` can see it, which is',
  'why this test exists.',
  '',
  'Import a browser-safe subpath instead:',
  "  import { ENCODER_ENTRIES } from '@axistream/capture/encoder-entries'",
  "  import { resolveEncoder, chipLabel } from '@axistream/capture/encoder-presets'",
  '',
  'Type-only imports (`import type ... from \'@axistream/capture\'`) are erased at',
  'build time and are allowed. If you need a new value from capture in the renderer,',
  'add another leaf subpath export in packages/capture/package.json — do not widen',
  'this rule.',
].join('\n')

describe('renderer/shared stay browser-safe', () => {
  it('never value-imports the @axistream/capture barrel', () => {
    const offenders: string[] = []
    for (const root of roots) {
      for (const file of walk(root)) {
        if (!/\.(ts|tsx)$/.test(file)) continue
        const src = readFileSync(file, 'utf8')
        BARE_BARREL.lastIndex = 0
        if (BARE_BARREL.test(src)) offenders.push(relative(pkg, file))
      }
    }

    expect(offenders, `\n${WHY}\n\nOffending files:\n  ${offenders.join('\n  ')}\n`).toEqual([])
  })
})
