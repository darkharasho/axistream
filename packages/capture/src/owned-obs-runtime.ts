import type { ObsLauncher } from './obs-launcher.js'

export interface OwnedObsLaunchSpec {
  launcher: ObsLauncher
  expectedObsVersion: string
  engineId: string
}

export interface OwnedObsRuntime {
  readonly engineId: string
  readonly configIdentity: string
  /** OBS's config directory; `<configRoot>/obs-studio/logs` holds OBS's own logs. */
  readonly configRoot: string
  prepare(): Promise<OwnedObsLaunchSpec>
}
