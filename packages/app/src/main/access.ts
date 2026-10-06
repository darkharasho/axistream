// Access check: blocks the app when the Discord server behind the announce
// webhook is on the Axi denylist. See README "Access".
import { createAccessGate, createConfig, webhookServers, type AccessGate, type AxiConfig, type Identity } from '@axiapps/axi-config'
import { blockIfTripped, handleBlocked, type ElectronLike, type RelaunchableApp } from '@axiapps/axi-config/electron'

export interface AccessDeps {
  electron: ElectronLike & { app: RelaunchableApp & { getPath(name: 'userData'): string } }
  config?: AxiConfig // tests inject one; production creates it
  onBlocked?: (info: { persisted: boolean }) => void // tests inject a spy
  /** Runs (and is awaited) before a runtime block exits/relaunches the app, so the OBS sidecar is torn down first. */
  beforeBlocked?: () => Promise<void>
  /** The announce webhook URL from settings (may be blank). */
  readWebhookUrl: () => string
  /** Resolves webhook URLs to Discord server identities. Tests inject a fake. */
  lookupWebhooks?: (urls: string[]) => Promise<Identity[]>
}

export type AccessBoot = { blocked: true } | { blocked: false; gate: AccessGate; config: AxiConfig }

export async function startAccess(deps: AccessDeps): Promise<AccessBoot> {
  const config = deps.config ?? createConfig({ appId: 'axistream', cacheDir: deps.electron.app.getPath('userData') })
  await config.ready()
  if (blockIfTripped(deps.electron, config)) return { blocked: true }
  const gate = createAccessGate({ config, onBlocked: deps.onBlocked ?? ((info) => {
      // handleBlocked may exit the app, skipping the window-close teardown:
      // run the hook first, and block regardless of whether it fails.
      void Promise.resolve()
        .then(() => deps.beforeBlocked?.())
        .catch(() => {})
        .finally(() => handleBlocked(deps.electron, config, info))
    }),
  })
  const lookup = deps.lookupWebhooks ?? ((urls: string[]) => webhookServers(urls))
  gate.addSource('announce-webhook', async () => {
    const url = deps.readWebhookUrl().trim()
    return url ? lookup([url]) : []
  })
  config.onChange(() => void gate.recheck())
  return { blocked: false, gate, config }
}
