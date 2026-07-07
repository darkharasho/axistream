const RULE_FILE = '/etc/udev/rules.d/70-axistream-input.rules'
const RULE = 'KERNEL=="event*", SUBSYSTEM=="input", TAG+="uaccess"'

/** The exact shell that runs as root via pkexec. uaccess tags grant the
 *  active seat's user ACL read access to input devices IMMEDIATELY after
 *  the udev trigger — no relogin, unlike group membership. */
export function unlockScript(): string {
  return `printf '%s\\n' '${RULE}' > ${RULE_FILE} && udevadm control --reload-rules && udevadm trigger --subsystem-match=input`
}

export type ExecFileLike = (cmd: string, args: string[]) => Promise<void>

export async function runInputUnlock(exec: ExecFileLike): Promise<{ ok: boolean; error?: string }> {
  try {
    await exec('pkexec', ['sh', '-c', unlockScript()])
    return { ok: true }
  } catch (e) {
    const code = (e as { code?: number }).code
    // pkexec: 126 = dialog dismissed/authorization refused, 127 = command not
    // found/executable — both surface to the user as a cancelled unlock
    if (code === 126 || code === 127) return { ok: false, error: 'Authorization was cancelled' }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
