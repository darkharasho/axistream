// Dev convenience: load credentials from the repo-root `.env` into process.env
// so `npm run dev` picks up AXI_YT_CLIENT_ID / AXI_YT_CLIENT_SECRET (and the
// spike key) without exporting them by hand. In dev, electron-vite runs the main
// process with cwd = packages/app, so the repo-root file sits at ../../.env;
// we also check cwd/.env in case it's run from the root. Packaged builds ship no
// .env (creds are baked in at build time), so existsSync skips this entirely.
import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    loadEnv({ path: candidate, quiet: true })
    break
  }
}
