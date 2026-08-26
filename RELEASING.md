# Releasing AxiStream

Pushing a tag matching `v*` triggers `.github/workflows/release.yml`.

## Before you tag

**Write the `RELEASE_NOTES.md` section first**, as `## Version vX.Y.Z — Month D, YYYY`.
The `publish` job reads the GitHub Release body out of it and fails when the section
is missing, so skipping this does not degrade the notes — it fails the release.

Write for the person running the app, not for the commit log: what changed, and what
it means for them. Every other Axi app's notes read this way.

Check it before pushing:

```sh
node scripts/release-notes.mjs vX.Y.Z
```

## Cutting a release

1. Bump `packages/app/package.json`'s `version` and commit it. (The build jobs also
   sync the version from the tag, but the committed value is what a dev build and the
   About panel report.)
2. Add the `RELEASE_NOTES.md` section and commit it.
3. Tag and push:

   ```sh
   git push origin main
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

4. Watch the run. The jobs are: `test` → `build` (Linux + Windows) and `build-mac`
   (signed + notarized) → `publish`.

`publish`, in order: sets the release body from `RELEASE_NOTES.md` (**fails here if the
section is missing**), uploads the OBS corresponding-source compliance assets, flips the
release out of draft, then announces to Discord if `DISCORD_RELEASE_CHANNEL_ID` is set.

The notes step is deliberately first. In v0.1.12 a later step died before
`--draft=false` ran and the release stayed invisible as a draft — anything that can fail
belongs before the release becomes public, not after.

## Secrets and variables

- `DISCORD_BOT_TOKEN` (secret) and `DISCORD_RELEASE_CHANNEL_ID` (variable) — the
  announcement. Absent, the release still publishes and the step is skipped.
- Mac signing: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- YouTube OAuth, baked into the bundle at build time: `AXI_YT_CLIENT_ID`,
  `AXI_YT_CLIENT_SECRET`. These must be stored **unquoted** — quoted values were
  baked in literally once and produced "OAuth client not found" at runtime.
