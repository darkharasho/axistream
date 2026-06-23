# Capture Provisioning — Testing

## Unit tests (CI)
`npm test` — fast, mocked, no OBS.

## Integration tests (need real OBS, local)
`npx vitest run --maxWorkers=2 --config vitest.integration.config.ts`
- `obs-sidecar.itest.ts` — launch/connect/teardown. No portal.
- `provision-restore.itest.ts` — SILENT restore path. Requires the `AxiStream`
  collection to already contain an approved capture source (run the manual
  first-run script once first).

## Manual first-run (cannot be automated — OS portal dialog)
`npx tsx scripts/manual-first-run.ts`
Approve the screen-share dialog (check "Remember"). Expect `READY`.
