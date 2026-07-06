export interface SingleInstanceDeps {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', cb: () => void): void
}

/** True = this process owns the app (second-instance callback armed).
 *  False = another instance is running; quit() has been called and the
 *  caller must not start the engine. A throwing lock request is treated
 *  as primary — worst case is the old two-instance behavior. */
export function enforceSingleInstance(d: SingleInstanceDeps, onSecondInstance: () => void): boolean {
  let locked = true
  try { locked = d.requestSingleInstanceLock() } catch { return true }
  if (!locked) { d.quit(); return false }
  d.on('second-instance', onSecondInstance)
  return true
}
