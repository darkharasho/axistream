import { join, resolve, sep } from 'node:path'

/** OBS writes recordings from inside its flatpak, whose /tmp is a private
 *  tmpfs. $HOME is the one tree mapped identically inside the sandbox — a path
 *  outside it makes the output die right after StartRecord reports success. */
export const RECORD_DIR_ERROR =
  "must be inside your home folder (AxiStream's OBS can't write outside it)"

export function defaultRecordDir(home: string): string {
  return join(home, 'Videos', 'AxiStream')
}

export function validateRecordDir(dir: string, home: string): { ok: boolean; error?: string } {
  if (!dir) return { ok: false, error: RECORD_DIR_ERROR }
  const target = resolve(dir)
  const root = resolve(home)
  // The trailing separator is load-bearing: a bare startsWith accepts
  // /home/user2 for a home of /home/u.
  if (target !== root && !target.startsWith(root + sep)) return { ok: false, error: RECORD_DIR_ERROR }
  return { ok: true }
}
