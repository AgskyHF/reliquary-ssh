import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(__dirname, 'shared'),
  '@app': resolve(__dirname, 'app'),
  '@protocols/index': resolve(__dirname, 'protocols/index.ts'),
  '@protocols': resolve(__dirname, 'protocols')
}

export default defineConfig({
  main: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'app/index.ts') }
      }
    }
  },
  preload: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'app/preload/index.ts') },
        // Electron loads the preload through CommonJS require() — keep the
        // .cjs extension so the path stays resolvable in the packaged app.
        output: {
          entryFileNames: '[name].cjs',
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    resolve: {
      alias: {
        ...alias,
        '@renderer': resolve(__dirname, 'renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'renderer/index.html')
      }
    }
  }
})
