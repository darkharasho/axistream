import type { ObsLauncher } from './obs-launcher.js'

export interface OwnedObsLaunchSpec {
  launcher: ObsLauncher
  expectedObsVersion: string
  engineId: string
}

export interface OwnedObsRuntime {
  readonly engineId: string
  readonly configIdentity: string
  prepare(): Promise<OwnedObsLaunchSpec>
}
