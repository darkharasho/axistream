# Owned OBS Runtime Isolation — Design

**Date:** 2026-07-21  
**Status:** Approved for planning  
**Scope:** Replace every shared/personal OBS integration on Windows and Linux with an AxiStream-owned OBS runtime, make Windows monitor setup functional and observable, and prove that AxiStream cannot modify or terminate the user's personal OBS installation.

## Incident and root cause

The Windows v0.1.11 path launches the user's installed `obs64.exe`, enables
obs-websocket in `%APPDATA%\obs-studio`, creates and selects an `AxiStream`
profile and scene collection, and runs `taskkill /F /IM obs64.exe` during
startup and shutdown. This changed the active personal OBS profile and
collection, exposed a blank profile with no stream service, and could discard
unsaved personal OBS state when the process was force-killed.

Capture setup was independently broken on normal Windows systems. AxiStream
creates `monitor_capture` with empty settings. In pinned OBS 32.1.2, the D3D11
display-capture implementation defaults `monitor_id` to the invalid
`{00000000-0000-0000-0000-000000000000}` selection. The headless Windows CI
runner exercised OBS's legacy fallback implementation, whose `monitor` setting
defaults to display zero. The smoke test therefore passed a different source
path from real hardware. While provisioning waits for a non-black frame, the
renderer remains on the unchanged setup screen; rejected IPC promises are not
rendered as errors.

The Linux path violates the same ownership boundary. It launches the standard
`com.obsproject.Studio` Flatpak, writes its configuration, selects AxiStream
profile/collection state inside it, and uses `flatpak kill
com.obsproject.Studio`. Flatpak keys persistent data and process control by app
ID, so this is the user's personal OBS instance, not an AxiStream-owned one.

## Non-negotiable safety invariant

> AxiStream may start, configure, inspect, or stop only an OBS runtime whose
> application identity, executable/runtime files, configuration root, and
> process identity are owned by AxiStream.

If ownership cannot be proven, capture fails closed. There is no fallback to an
installed executable, the standard OBS Flatpak ID, `%APPDATA%\obs-studio`, or
`~/.var/app/com.obsproject.Studio`.

## Approaches considered

### 1. Bundled owned runtimes — selected

Pin and bundle the official Windows portable archive and a separately identified
Linux Flatpak build. This increases release size and packaging work, but setup is
offline, deterministic, testable, and isolated from personal OBS.

### 2. Download an owned runtime on first use

This keeps the Electron installer smaller but makes first capture dependent on
network and upstream availability. Hash verification would provide integrity,
but not availability. It is rejected for the primary path.

### 3. Redirect configuration while reusing personal OBS

Windows portable mode cannot safely write configuration beside a Program Files
installation, and the standard Linux Flatpak always binds persistent storage by
its app ID. Reusing the installation also leaves process ownership ambiguous.
This approach cannot satisfy the invariant and is rejected.

## Runtime architecture

### `OwnedObsRuntime`

A new app-main boundary prepares a platform runtime before `ObsSidecar` is
constructed:

```ts
interface OwnedObsRuntime {
  readonly engineId: string
  readonly configIdentity: string
  prepare(): Promise<OwnedObsLaunchSpec>
}

interface OwnedObsLaunchSpec {
  launcher: ObsLauncher
  expectedObsVersion: string
}
```

`prepare()` either returns a launch spec with established ownership or throws a
human-readable runtime error. Callers never substitute another launcher.

The first release using this design invalidates old `capture.json` data. The
capture config becomes schema version 2 and records `engineId` alongside the
platform and selected target. A missing schema/engine mismatch is
`UNPROVISIONED`; AxiStream performs one clean setup in its new runtime and never
imports or deletes old personal OBS data.

### Windows runtime

The release workflow downloads the official
`OBS-Studio-32.1.2-Windows-x64.zip` and verifies the upstream SHA-256
`8d97e4563bd8d22d03e63042aa7dccede1d555c9bd35ce8a9e5019b0d0201bf6`.
The verified archive and a small signed manifest are packaged as Electron extra
resources. The corresponding OBS source archive and GPL notice are published
with the AxiStream release.

On first boot, `WindowsOwnedObsRuntime`:

1. verifies the packaged archive against the compiled manifest;
2. rejects absolute paths, drive prefixes, `..`, symlinks, and entries escaping
   the staging root while extracting;
3. extracts into a temporary sibling of
   `%LOCALAPPDATA%\AxiStream\obs-runtime\32.1.2`;
4. writes an ownership marker containing engine ID, archive hash, and expected
   executable relative path;
5. atomically renames the completed staging directory into place.

Interrupted extraction is discarded on the next run. Existing valid runtimes
are reused. Immutable engine files and the ownership marker are validated before
each launch. Repair replaces engine files through a staging directory while
preserving only the owned `config` directory.

OBS is launched from the explicit private executable path with `--portable`,
`--disable-updater`, `--disable-missing-files-check`, `--multi`, the private
collection, and randomized websocket credentials. The obsolete
`--disable-shutdown-check` flag is removed for OBS 32.1.2. obs-websocket's
`server_enabled` setting is written only under the portable runtime's
`config\obs-studio\plugin_config\obs-websocket` directory.

`WindowsObsLauncher` no longer resolves Program Files or reads `APPDATA`. It
accepts only the validated launch spec. It assigns the spawned OBS process to a
Windows Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; setup
fails if containment cannot be established. Normal shutdown targets the owned
process/job only. The image-wide `taskkill` implementation is deleted.

### Linux runtime

The Linux release builds OBS 32.1.2 as a Flatpak application with the dedicated
ID `link.axi.AxiStream.OBS`, using a pinned manifest derived from the upstream
OBS/Flathub build. A signed single-file Flatpak bundle is packaged with the
Linux AxiStream artifacts. `LinuxOwnedObsRuntime.prepare()` installs or updates
that local bundle per-user, non-interactively, verifies the installed origin,
app ID, branch, and commit, then returns a launcher for that exact identity.

Flatpak consequently stores configuration below
`~/.var/app/link.axi.AxiStream.OBS`, separate from personal
`com.obsproject.Studio` data. Visible and headless cage launchers both receive
the owned app ID instead of containing a hardcoded standard ID. Shutdown uses
`flatpak kill link.axi.AxiStream.OBS`; it cannot target personal OBS.

If Flatpak, the required platform runtime, the signed bundle, or the exact owned
application is unavailable, AxiStream reports the runtime error and launches
nothing. It never falls back to `com.obsproject.Studio`.

## Windows capture-target flow

Windows provisioning becomes an explicit prepare/select/verify flow:

1. The setup button immediately enters a local busy state and main pushes
   `PREPARING_CAPTURE`.
2. The provisioner creates the owned `AxiStream Capture` input and queries OBS
   through `GetInputPropertiesListPropertyItems` for `monitor_id`. If that
   property is absent, it queries legacy `monitor`.
3. Disabled placeholder entries are removed. Zero usable targets is an error;
   one target is selected automatically; multiple targets are returned to the
   renderer as `{ property, value, label }` entries.
4. The renderer presents the OBS-provided labels in a small monitor chooser.
   Cancellation returns to `SETTING_UP` without marking capture provisioned.
5. Selection calls `SetInputSettings` using the exact property/value pair, then
   the existing non-black-frame check runs.
6. Only a verified frame writes schema-2 capture config and transitions to the
   YouTube/ready phase.

Target values are opaque strings or numbers from OBS. AxiStream never guesses a
mapping from Electron display IDs. Repair and Switch Source reuse the same
target flow. Linux retains its portal selection flow under the owned Flatpak ID.

The shared API gains `CaptureTargetOption`, a target-list IPC request, and a
selection-bearing provision request. `StreamPhase` gains
`PREPARING_CAPTURE` and `CHOOSING_CAPTURE`; neither phase can expose Go Live.

## User-visible error behavior

All capture actions are caught at the main-process boundary. Expected failures
have stable messages for:

- owned runtime missing, corrupt, or unverifiable;
- extraction/install failure;
- OBS launch, containment, version, or websocket failure;
- no capture targets;
- target application failure;
- no non-black frame before the bounded deadline.

The setup CTA disables and shows progress while an action is in flight. The
monitor chooser shows only during `CHOOSING_CAPTURE`. Failure transitions to an
error panel with the message and a Retry Setup action; it never silently returns
to the unchanged screen. Double clicks cannot start concurrent provisioning.

Runtime errors occur before any OBS process is started. Provisioning errors stop
the owned sidecar before presenting retry when its state is no longer reliable.

## Emergency safety behavior

Every source build, including development builds without packaged runtime
assets, uses the fail-closed owned-runtime resolver. A missing asset disables
capture with a clear error instead of probing installed OBS. This is the
emergency safety release behavior and remains a permanent defense.

Development and CI may supply a runtime override only when its root contains a
valid AxiStream ownership marker matching the expected engine ID and executable.
There is no arbitrary executable-path escape hatch.

Automatic recovery of the old personal OBS profile is explicitly prohibited.
The old build did not persist the prior profile/collection names, so guessing
could cause additional damage. A Windows recovery document explains that OBS
profiles hold Stream (including connected account), Video, and Output settings,
while scene collections hold scenes/sources. Users are told to back up
`%APPDATA%\obs-studio` before selecting their prior profile and collection.

## Packaging and licensing

Release preparation is explicit and reproducible:

- a checked-in manifest pins OBS version, asset URLs, hashes, engine IDs, and
  expected entry points;
- preparation scripts download to a cache, verify before staging, and never
  accept a moving `latest` URL;
- Electron packaging fails when the platform's owned runtime asset is absent;
- OBS `COPYING`, third-party notices, exact upstream source URL, and corresponding
  source archive are included/published as required for redistribution;
- OBS updates are deliberate manifest changes with their own Windows and Linux
  smoke evidence, never automatic sidecar self-updates.

macOS remains unsupported and fails closed; there is no installed-OBS fallback.

## Testing and proof obligations

### Unit tests

- Windows runtime archive hash, ownership-marker validation, zip-slip/symlink
  rejection, interrupted extraction, reuse, and repair-with-config-preservation.
- Windows launcher exact executable/arguments/config root and process-container
  calls; containment failure kills only the new child and rejects launch.
- Linux runtime app-ID/origin/commit verification and no-standard-ID fallback.
- Visible and headless Linux launchers use injected owned app IDs.
- Capture config v1/missing/mismatched engine invalidation and v2 round trip.
- Monitor property enumeration for modern `monitor_id`, legacy `monitor`, zero,
  one, multiple, disabled placeholder, selection, cancellation, and frame timeout.
- Capture service/main handlers translate every rejection into visible error
  state and reject duplicate concurrent actions.
- Renderer progress, chooser, cancellation, retry, and error-message tests.

### Static isolation gate

A test scans production launch/config code and fails on these prohibited
personal-OBS operations:

- Program Files/LOCALAPPDATA installed-OBS probing;
- `%APPDATA%\obs-studio` writes;
- `taskkill /IM obs64.exe`;
- `com.obsproject.Studio` as a launch or kill target;
- fallback construction of `FlatpakObsLauncher` for the standard app ID.

The scan supplements behavioral tests; it is not the sole evidence.

### Platform smoke tests

Windows CI stages the exact portable archive used by the release instead of
installing Chocolatey OBS. Before launch it creates a sentinel personal OBS
config tree and records a recursive content hash. The smoke provisions against
the private runtime, shuts down, proves the personal tree is byte-for-byte
unchanged, and proves no unrelated `obs64.exe` PID was terminated.

Linux CI installs the dedicated Flatpak bundle, seeds a sentinel
`~/.var/app/com.obsproject.Studio` tree, runs the owned sidecar, then proves the
sentinel tree is unchanged and the standard Flatpak app was never started or
killed.

### Manual hardware acceptance

On Windows 10/11 with real D3D11 and at least two displays:

1. run personal OBS with a configured YouTube account, custom resolution, and
   unsaved scene change;
2. start AxiStream and confirm personal OBS remains running and unchanged;
3. select each monitor and verify the preview matches it;
4. cancel and retry setup; verify truthful states and no duplicate sidecars;
5. restart AxiStream and verify target persistence and silent private-runtime
   boot;
6. go live and stop; verify personal OBS profile, collection, service, resolution,
   and process remain unchanged.

On Linux, repeat concurrent-personal-OBS and first-run portal approval using
the standard OBS Flatpak plus the separately identified AxiStream Flatpak.

## Completion criteria

The change is complete only when:

1. production code has no path that launches, configures, or broadly kills
   personal OBS on Windows or Linux;
2. packaged builds contain verified, pinned owned runtimes and fail closed when
   those runtimes are unavailable;
3. Windows hardware setup selects a real monitor and reaches ready only with a
   verified frame;
4. setup progress, errors, cancellation, and retry are visible and tested;
5. unit, typecheck, build, static isolation, and both platform smoke suites pass;
6. manual Windows and Linux hardware acceptance is recorded for the exact
   packaged runtime versions.
