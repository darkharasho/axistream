# Third-Party Notices

AxiStream redistributes the following software. Upstream copyright and license
files remain authoritative.

## OBS Studio

- Project: [OBS Studio](https://github.com/obsproject/obs-studio)
- Version: 32.1.2
- License: GPL-2.0-or-later

AxiStream distributes OBS Studio as an application-owned runtime; it does not
reuse or modify a user's own OBS installation. The complete corresponding
source for the bundled build is attached to every AxiStream release. See
[docs/obs-redistribution.md](docs/obs-redistribution.md) for the exact build
inputs, runtime identities, and reproduction steps.

## Electron

- Project: [Electron](https://github.com/electron/electron)
- License: MIT

## Bundled npm dependencies

AxiStream's packaged application includes its production npm dependencies.
Their licenses are those declared in each package's own `package.json`; the
full set for a given build can be listed with `npm ls --omit=dev` at that
version's tag.
