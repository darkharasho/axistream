import { describe, it, expect, vi } from 'vitest'
import { ensureDesktopEntry } from '../src/main/desktop-entry.js'

function harness(existing: string | null = null) {
  const writes: { path: string; content: string }[] = []
  const dirs: string[] = []
  const deps = {
    mkdir: vi.fn(async (p: string) => { dirs.push(p) }),
    readFile: vi.fn(async () => { if (existing === null) throw new Error('ENOENT'); return existing }),
    writeFile: vi.fn(async (p: string, c: string) => { writes.push({ path: p, content: c }) }),
  }
  return { deps, writes, dirs }
}

describe('ensureDesktopEntry', () => {
  it('writes link.axi.axistream.desktop with the running binary as Exec', async () => {
    const h = harness()
    await ensureDesktopEntry('/opt/axistream/axistream', '/home/u', h.deps)
    expect(h.dirs[0]).toBe('/home/u/.local/share/applications')
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0].path).toBe('/home/u/.local/share/applications/link.axi.axistream.desktop')
    expect(h.writes[0].content).toContain('[Desktop Entry]')
    expect(h.writes[0].content).toContain('Name=AxiStream')
    expect(h.writes[0].content).toContain('Exec="/opt/axistream/axistream"')
    expect(h.writes[0].content).toContain('Type=Application')
  })

  it('is idempotent — skips the write when content already matches', async () => {
    const first = harness()
    await ensureDesktopEntry('/usr/bin/axistream', '/home/u', first.deps)
    const second = harness(first.writes[0].content)
    await ensureDesktopEntry('/usr/bin/axistream', '/home/u', second.deps)
    expect(second.writes).toHaveLength(0)
  })

  it('rewrites when the Exec path changed (dev vs packaged binary)', async () => {
    const first = harness()
    await ensureDesktopEntry('/old/electron', '/home/u', first.deps)
    const second = harness(first.writes[0].content)
    await ensureDesktopEntry('/new/axistream', '/home/u', second.deps)
    expect(second.writes).toHaveLength(1)
  })

  it('never throws (best-effort)', async () => {
    const deps = {
      mkdir: vi.fn(async () => { throw new Error('read-only fs') }),
      readFile: vi.fn(async () => { throw new Error('ENOENT') }),
      writeFile: vi.fn(async () => { throw new Error('read-only fs') }),
    }
    await expect(ensureDesktopEntry('/x', '/home/u', deps)).resolves.toBeUndefined()
  })
})
