# AxiStream App — Testing

## Unit (CI): `npm -w @axistream/app run test` — jsdom + mocked window.axi/services.
## E2e shell smoke (local): `npm -w @axistream/app run build && npm -w @axistream/app exec playwright test`
## Manual full-path (real OBS, Wayland portal): launch `npm -w @axistream/app run dev`,
  click "Set up capture", approve the screen-share dialog (check Remember), paste a
  YouTube stream key, click Go Live, confirm the stream on YouTube, End Stream.
  First-run portal approval cannot be automated.

## OBS visibility (Linux)
On Linux the app launches OBS **headless** (invisible) inside `cage`
(`WLR_BACKENDS=headless`). Set `AXISTREAM_OBS_VISIBLE=1` to force a visible OBS
window for debugging. If `cage` is not installed, the app automatically falls
back to a visible OBS window.

### Manual first-run check (headless capture)
Launch the app (`npm -w @axistream/app run dev`), click "Set up capture",
approve the screen-share dialog (it appears on your real screen even though OBS
is headless), and confirm: the live preview thumbnail renders the real screen
while OBS has no visible window, and streaming works.
