# AxiStream App — Testing

## Unit (CI): `npm -w @axistream/app run test` — jsdom + mocked window.axi/services.
## E2e shell smoke (local): `npm -w @axistream/app run build && npm -w @axistream/app exec playwright test`
## Manual full-path (real OBS, Wayland portal): launch `npm -w @axistream/app run dev`,
  click "Set up capture", approve the screen-share dialog (check Remember), paste a
  YouTube stream key, click Go Live, confirm the stream on YouTube, End Stream.
  First-run portal approval cannot be automated.
