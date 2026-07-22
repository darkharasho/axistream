# OBS runtime provenance and redistribution

AxiStream distributes OBS Studio 32.1.2 as an application-owned runtime. It does not reuse or modify a user's OBS installation.

## Runtime identities

- Windows: official `OBS-Studio-32.1.2-Windows-x64.zip`, SHA-256 `8d97e4563bd8d22d03e63042aa7dccede1d555c9bd35ce8a9e5019b0d0201bf6`, extracted into AxiStream's private runtime directory and launched in portable mode.
- Linux: a bundle built from OBS tag `32.1.2`, commit `fb4d98bf88fae5fc85cb11fc57f7c5e309282194`, under the dedicated Flatpak application ID `link.axi.AxiStream.OBS`. The build uses Freedesktop runtime 25.08 and the pinned inputs in `packaging/flatpak/link.axi.AxiStream.OBS.json`.

`resources/obs-runtime/manifest.json` is the source of truth for engine IDs, URLs, and hashes. Packaging fails closed if the selected platform payload is missing or its hash does not match. At runtime, Linux also verifies the installed Flatpak ref, OSTree commit, and origin before it may launch OBS.

## Reproducing the payloads

Install Node.js 22 and project dependencies. On Linux, install Flatpak and `flatpak-builder`, configure the Flathub remote, then run:

```bash
npm ci
npm run prepare:obs-runtime -- --platform=linux
```

To fetch and verify the official Windows portable archive:

```bash
npm ci
npm run prepare:obs-runtime -- --platform=windows
```

The Linux build also creates `obs-studio-32.1.2-axistream-corresponding-source.tar.xz` from recursive, commit-verified checkouts of OBS and its bundled PipeWire Audio Capture and Composite Blur plugins. Release automation publishes that archive and the exact Flatpak recipe alongside AxiStream binaries. Generated runtime payloads are intentionally excluded from Git because of their size.

OBS Studio is licensed under GPL-2.0-or-later. Upstream copyright and license files remain authoritative; the release's corresponding-source archive contains the source and license material used for the bundled OBS build.
