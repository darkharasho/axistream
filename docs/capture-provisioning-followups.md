# Capture Provisioning — Deferred Follow-ups

The `axistream-capture` library (capture-provisioning subsystem) is implemented and unit-verified. These items were consciously deferred during the final whole-branch review; capture them when the relevant downstream spec is built.

## For the UI-integration spec
- **`onApprovalNeeded` fires unconditionally on every Wayland `provision()`** (`src/provisioner.ts`, the `onApprovalNeeded?.()` call). On a returning user whose capture auto-restores silently, the callback still fires — a UI wired to it could show a spurious "approve the dialog" prompt. Decide the intended semantics (e.g. fire only after the first poll round returns black, i.e. a portal is actually needed) when the UI defines what the callback drives. Note: changing this also lets the silent-restore integration test assert `approvalFired === false`, and will require updating the Task 5 happy-path unit test which currently asserts the callback fires once.
- **Silent-restore integration test under-asserts "silent"** (`test/integration/provision-restore.itest.ts`). It asserts only that a returning user reaches `READY`, not that no portal appeared. Tighten once the `onApprovalNeeded` semantics above are decided.

## For the app shell / lifecycle
- **Single-instance lock** (design spec error-handling §): not implemented in the library. Two AxiStream instances must not fight over the sidecar. Belongs in the Electron app shell.
- **"Remember not honored" detection**: detect repeated `AWAITING_APPROVAL` across launches (a compositor that doesn't persist the portal grant), log it, and keep the guided path. Needs cross-launch state the library doesn't yet persist.

## Accepted as-is (no action needed)
- `GetInputList` cleanup uses a bare `client.call` (best-effort, crash-proof via `?? []`).
- `ProvisionerSidecar.client().call` typed `(...args: any[])` to structurally accept the real `OBSWebSocket.call` overloads.
- `randomPassword()` moderate entropy — loopback-only, ephemeral per launch (could move to `crypto.randomBytes` later, one line).
