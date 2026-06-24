import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// `ws` (pulled in transitively via @axistream/capture -> obs-websocket-js)
// optionally requires these native addons; they aren't installed and ws works
// without them. Mark them external so the bundle leaves them as runtime requires
// (which ws try/catches) instead of failing to resolve them at bundle/load time.
const wsOptionalNatives = ['bufferutil', 'utf-8-validate']

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
        external: wsOptionalNatives,
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
        external: wsOptionalNatives,
      },
    },
  },
  renderer: {
    root: resolve(__dirname),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, 'index.html') } },
  },
})
