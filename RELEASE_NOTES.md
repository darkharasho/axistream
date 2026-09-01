# Release Notes

## Version v1.0.2 — August 31, 2026

Windows fixes, and a way to send us a bug report that we can actually act on.

### Your character and map show up in stream titles on Windows
Title variables like `{{character}}`, `{{class}}` and `{{map}}` read the live game state out of Guild Wars 2 — and on Windows they always came back blank, so `2026-08-31 WvW Raid - {{character}} - {{class}}` went live as `2026-08-31 WvW Raid -  -`. AxiStream now reads that game state on Windows the same way it does on Linux. Guild Wars 2 has to be running and you have to be in a map; on the character-select screen the game publishes nothing to read.

### Titles no longer trail off into dashes
Separately: when a title variable had nothing to fill in — Guild Wars 2 closed when you went live, say — the dashes and pipes around it were left stranded. Those now get cleaned up, so an unresolved variable leaves no trace instead of a row of punctuation. Dashes you typed between real text are untouched.

### Export diagnostics
Settings has an Export diagnostics button. It bundles the app log, OBS's logs, and your encoder and device settings into a single zip you can attach to a bug report, with a Show in folder button so you can find it. Your stream key, YouTube sign-in, and Discord webhook are left out of the bundle.

### Groundwork for the disappearing-preview report
We have a report that the in-app preview goes blank on Windows when you go live, while the stream itself keeps working. This release doesn't fix that — it adds the logging needed to tell the two possible causes apart. If you hit this, go live once, then send us the diagnostics bundle.

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
