export interface RuntimeSourceManifest {
  windows: { archiveFile: string; archiveSha256: string }
  linux: { bundleFile: string }
}

export function sha256File(path: string): Promise<string>
export function verifyRuntimeAssets(
  platform: NodeJS.Platform,
  root: string,
  manifest: RuntimeSourceManifest,
): Promise<void>

export interface LinuxRuntimePrebuilt {
  obsVersion: string
  bundleUrl: string
  bundleSha256: string
  descriptorUrl: string
  descriptorSha256: string
  correspondingSourceUrl: string
  correspondingSourceSha256: string
}

export function selectLinuxRuntimeSource(
  linux: { obsVersion: string; prebuilt?: LinuxRuntimePrebuilt },
  options?: { fromSource?: boolean },
): 'prebuilt' | 'source'
