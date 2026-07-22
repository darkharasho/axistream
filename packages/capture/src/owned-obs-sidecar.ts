import type { OwnedObsRuntime } from './owned-obs-runtime.js'
import { ObsSidecar, type ObsSidecarOptions } from './obs-sidecar.js'

type CrashListener = () => void

export interface OwnedObsSidecarOptions {
  runtime: OwnedObsRuntime
  collection: string
  makeSidecar?: (options: ObsSidecarOptions) => ObsSidecar
}

/** Defers ObsSidecar construction until the platform runtime has proven its
 * ownership. A failed prepare therefore has no launcher and cannot start OBS. */
export class OwnedObsSidecar {
  private inner?: ObsSidecar
  private readonly listeners: CrashListener[] = []
  private readonly makeSidecar: NonNullable<OwnedObsSidecarOptions['makeSidecar']>

  constructor(private readonly options: OwnedObsSidecarOptions) {
    this.makeSidecar = options.makeSidecar ?? ((sidecarOptions) => new ObsSidecar(sidecarOptions))
  }

  async start(): Promise<void> {
    if (this.inner) return
    const spec = await this.options.runtime.prepare()
    const inner = this.makeSidecar({
      launcher: spec.launcher,
      collection: this.options.collection,
      expectedObsVersion: spec.expectedObsVersion,
    })
    for (const listener of this.listeners) inner.on('crashed', listener)
    await inner.start()
    this.inner = inner
  }

  client(): ReturnType<ObsSidecar['client']> {
    if (!this.inner) throw new Error('Owned OBS sidecar is not started')
    return this.inner.client()
  }

  wsInfo(): ReturnType<ObsSidecar['wsInfo']> { return this.inner?.wsInfo() ?? null }

  on(event: 'crashed', callback: CrashListener): void {
    if (event !== 'crashed') return
    this.listeners.push(callback)
    this.inner?.on('crashed', callback)
  }

  async stop(): Promise<void> {
    const inner = this.inner
    this.inner = undefined
    await inner?.stop()
  }

  async restart(): Promise<void> {
    if (!this.inner) { await this.start(); return }
    await this.inner.restart()
  }
}
