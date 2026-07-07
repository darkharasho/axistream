export interface DesktopEntryDeps {
  mkdir(path: string): Promise<unknown>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<unknown>
}

export const APP_ID = 'link.axi.axistream'

// Host (non-flatpak) apps prove their identity to xdg-desktop-portal via an
// installed .desktop entry matching the app id — without one the portal
// Registry refuses ("App info not found") and GlobalShortcuts sessions are
// denied ("An app id is required"). Install/refresh ours at boot, pointing
// Exec at whatever binary is actually running (dev electron or the packaged
// app). Best-effort: a failure only means PTT stays unavailable.
export async function ensureDesktopEntry(execPath: string, homeDir: string, d: DesktopEntryDeps): Promise<void> {
  try {
    const dir = `${homeDir}/.local/share/applications`
    const path = `${dir}/${APP_ID}.desktop`
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=AxiStream',
      `Exec="${execPath}"`,
      'NoDisplay=true',
      '',
    ].join('\n')
    await d.mkdir(dir)
    const existing = await d.readFile(path).catch(() => null)
    if (existing === content) return
    await d.writeFile(path, content)
  } catch (e) {
    console.warn('[ptt] desktop entry install failed', e instanceof Error ? e.message : e)
  }
}
