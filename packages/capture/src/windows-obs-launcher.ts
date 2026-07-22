import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { win32 } from 'node:path'
import type { ObsLauncher, ObsLaunchHandle } from './obs-launcher.js'

export interface WebsocketConfigDeps {
  mkdir(path: string): void
  read(path: string): string | null
  write(path: string, content: string): void
}

const realConfigDeps: WebsocketConfigDeps = {
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  read: (path) => { try { return readFileSync(path, 'utf8') } catch { return null } },
  write: (path, content) => writeFileSync(path, content),
}

export function enableOwnedObsWebsocketServer(
  configRoot: string,
  deps: WebsocketConfigDeps = realConfigDeps,
  joinPath: (...paths: string[]) => string = win32.join,
): void {
  const dir = joinPath(configRoot, 'obs-studio', 'plugin_config', 'obs-websocket')
  const file = joinPath(dir, 'config.json')
  deps.mkdir(dir)
  let config: Record<string, unknown> = {}
  const existing = deps.read(file)
  if (existing) {
    try { config = JSON.parse(existing) as Record<string, unknown> } catch { config = {} }
  }
  if (config['server_enabled'] === true) return
  config['server_enabled'] = true
  deps.write(file, JSON.stringify(config, null, 2))
}

export interface WindowsProcessContainer {
  assign(pid: number): void
  close(): void
}

interface WindowsJobApi {
  createJob(): unknown
  configureKillOnClose(job: unknown): boolean
  openProcess(pid: number): unknown
  assign(job: unknown, process: unknown): boolean
  close(handle: unknown): void
}

class JobObjectContainer implements WindowsProcessContainer {
  private readonly job: unknown

  constructor(private readonly api: WindowsJobApi) {
    this.job = api.createJob()
    if (!this.job || !api.configureKillOnClose(this.job)) {
      if (this.job) api.close(this.job)
      throw new Error('Could not create AxiStream OBS process container')
    }
  }

  assign(pid: number): void {
    const processHandle = this.api.openProcess(pid)
    if (!processHandle) throw new Error('Could not open AxiStream OBS process for containment')
    try {
      if (!this.api.assign(this.job, processHandle)) {
        throw new Error('AssignProcessToJobObject failed')
      }
    } finally {
      this.api.close(processHandle)
    }
  }

  close(): void { this.api.close(this.job) }
}

function createWindowsJobApi(): WindowsJobApi {
  if (process.platform !== 'win32') throw new Error('Windows Job Objects are only available on Windows')
  const require = createRequire(import.meta.url)
  const koffi = require('koffi') as typeof import('koffi')
  const kernel32 = koffi.load('kernel32.dll')
  const BasicLimit = koffi.struct('JOBOBJECT_BASIC_LIMIT_INFORMATION', {
    PerProcessUserTimeLimit: 'int64', PerJobUserTimeLimit: 'int64', LimitFlags: 'uint32',
    MinimumWorkingSetSize: 'uintptr_t', MaximumWorkingSetSize: 'uintptr_t', ActiveProcessLimit: 'uint32',
    Affinity: 'uintptr_t', PriorityClass: 'uint32', SchedulingClass: 'uint32',
  })
  const IoCounters = koffi.struct('IO_COUNTERS', {
    ReadOperationCount: 'uint64', WriteOperationCount: 'uint64', OtherOperationCount: 'uint64',
    ReadTransferCount: 'uint64', WriteTransferCount: 'uint64', OtherTransferCount: 'uint64',
  })
  const ExtendedLimit = koffi.struct('JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
    BasicLimitInformation: BasicLimit,
    IoInfo: IoCounters,
    ProcessMemoryLimit: 'uintptr_t', JobMemoryLimit: 'uintptr_t',
    PeakProcessMemoryUsed: 'uintptr_t', PeakJobMemoryUsed: 'uintptr_t',
  })
  const CreateJobObjectW = kernel32.func('void *CreateJobObjectW(void *attributes, const char16_t *name)')
  const SetInformationJobObject = kernel32.func('bool SetInformationJobObject(void *job, int infoClass, void *info, uint32 length)')
  const OpenProcess = kernel32.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)')
  const AssignProcessToJobObject = kernel32.func('bool AssignProcessToJobObject(void *job, void *process)')
  const CloseHandle = kernel32.func('bool CloseHandle(void *handle)')
  return {
    createJob: () => CreateJobObjectW(null, null),
    configureKillOnClose: (job) => {
      const info = {
        BasicLimitInformation: {
          PerProcessUserTimeLimit: 0, PerJobUserTimeLimit: 0, LimitFlags: 0x00002000,
          MinimumWorkingSetSize: 0, MaximumWorkingSetSize: 0, ActiveProcessLimit: 0,
          Affinity: 0, PriorityClass: 0, SchedulingClass: 0,
        },
        IoInfo: {
          ReadOperationCount: 0, WriteOperationCount: 0, OtherOperationCount: 0,
          ReadTransferCount: 0, WriteTransferCount: 0, OtherTransferCount: 0,
        },
        ProcessMemoryLimit: 0, JobMemoryLimit: 0, PeakProcessMemoryUsed: 0, PeakJobMemoryUsed: 0,
      }
      // SetInformationJobObject's `info` param is `void *`; koffi.as casts to a
      // POINTER to the struct — passing the struct type itself throws
      // "Only pointer or string types can be used for casting".
      return Boolean(SetInformationJobObject(job, 9, koffi.as(info, koffi.pointer(ExtendedLimit)), koffi.sizeof(ExtendedLimit)))
    },
    openProcess: (pid) => OpenProcess(0x0001 | 0x0100, false, pid),
    assign: (job, processHandle) => Boolean(AssignProcessToJobObject(job, processHandle)),
    close: (handle) => { CloseHandle(handle) },
  }
}

export interface WindowsObsLauncherOptions {
  executablePath: string
  configRoot: string
  spawn?: typeof nodeSpawn
  createContainer?: () => WindowsProcessContainer
  configureWebsocket?: (configRoot: string) => void
}

export class WindowsObsLauncher implements ObsLauncher {
  private child?: ChildProcess
  private container?: WindowsProcessContainer
  private readonly spawn: typeof nodeSpawn
  private readonly createContainer: () => WindowsProcessContainer
  private readonly configureWebsocket: (configRoot: string) => void

  constructor(private readonly options: WindowsObsLauncherOptions) {
    this.spawn = options.spawn ?? nodeSpawn
    this.createContainer = options.createContainer ?? (() => new JobObjectContainer(createWindowsJobApi()))
    this.configureWebsocket = options.configureWebsocket ?? enableOwnedObsWebsocketServer
  }

  launch(args: string[]): ObsLaunchHandle {
    if (this.child) throw new Error('AxiStream OBS is already running')
    this.configureWebsocket(this.options.configRoot)
    const container = this.createContainer()
    const launchArgs = [
      '--portable', '--disable-updater', '--disable-missing-files-check', '--multi',
      '--minimize-to-tray', '--websocket_ipv4_only', ...args,
    ]
    const child = this.spawn(this.options.executablePath, launchArgs, {
      cwd: win32.dirname(this.options.executablePath), stdio: 'ignore', detached: false,
    })
    try {
      if (!child.pid) throw new Error('AxiStream OBS process did not provide a PID')
      container.assign(child.pid)
    } catch (error) {
      try { child.kill() } catch { /* the child may already have exited */ }
      container.close()
      throw new Error(`Could not contain AxiStream OBS: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.child = child
    this.container = container
    child.once('exit', () => {
      if (this.child === child) {
        this.child = undefined
        this.container = undefined
      }
    })
    return {
      kill: () => { void this.stopOwned() },
      onExit: (callback) => child.on('exit', callback),
    }
  }

  async stopOwned(): Promise<void> {
    const child = this.child
    const container = this.container
    this.child = undefined
    this.container = undefined
    if (container) {
      try { container.close() } catch { /* already closed */ }
    }
    if (child) {
      try { child.kill() } catch { /* already exited */ }
    }
  }
}
