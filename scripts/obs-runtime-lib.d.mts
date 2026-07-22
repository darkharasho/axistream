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
