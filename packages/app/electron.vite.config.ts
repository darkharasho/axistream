import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// `ws` (pulled in transitively via @axistream/capture -> obs-websocket-js)
// optionally requires these native addons; they aren't installed and ws works
// without them. Mark them external so the bundle leaves them as runtime requires
// (which ws try/catches) instead of failing to resolve them at bundle/load time.
// `usocket` is dbus-next's identical case (optional native for abstract-socket
// dbus addresses; modern sessions use path= and never hit it). dbus-next's
// optional 'x11' require can't be safely externalized (rollup hoists it into a
// top-level import that crashes at load) — it's aliased to a bundled stub in
// the main config below instead.
const optionalNatives = ['bufferutil', 'utf-8-validate', 'usocket', 'koffi']

export default defineConfig({
  main: {
    resolve: {
      alias: { x11: resolve(__dirname, 'src/main/x11-stub.ts') },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
        external: optionalNatives,
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.cjs',
        },
        external: optionalNatives,
      },
    },
  },
  renderer: {
    root: resolve(__dirname),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, 'index.html') } },
  },
})
