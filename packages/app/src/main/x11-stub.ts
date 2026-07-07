// dbus-next requires 'x11' (an uninstalled optional dep) only inside its
// X11-autolaunch DBus address discovery, which never runs when
// DBUS_SESSION_BUS_ADDRESS is set (always true on modern sessions). Rollup's
// commonjs interop hoists that require into a top-level import that crashes
// the app at load, so the bundler aliases 'x11' here instead. If the
// autolaunch path is ever genuinely reached, fail loudly.
export default {
  createClient(): never { throw new Error('x11 dbus autolaunch is not supported') },
}
