# Release Notes

## Version v1.0.1 — August 26, 2026

A Windows fix release.

### Capture works on Windows again
Windows installs failed at "Capture setup failed — The packaged AxiStream OBS runtime failed integrity verification". The installer was missing the manifest that records the expected checksum of the bundled OBS runtime, so AxiStream refused to trust its own copy of OBS. The manifest now ships with the runtime and capture starts normally.

### Update checks stopped 404ing
Auto-update was pointed at the wrong release and reported "Cannot find latest.yml". Releases are now explicitly promoted so update checks always resolve to an AxiStream app release.

## Version v1.0.0 — August 25, 2026

AxiStream 1.0. Three clicks from a cold start to live on YouTube, on Windows and Linux. (macOS is not in this release.)

### Setup walks you through it now
A first launch offers a two-minute setup: pick the screen showing your game, connect YouTube, and hear your own microphone played back before anyone else does. It's a banner, not a gate — dismiss it and go live immediately if you already know what you're doing. You can run it again any time from Settings → About.

### About, and where the OBS source lives
Settings has an About panel: the version you're running, and links to the licenses, the privacy policy, and how AxiStream bundles OBS Studio. AxiStream ships its own OBS 32.1.2 build rather than touching yours, and the complete corresponding source for it is attached to every release.
