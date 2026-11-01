import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(__dirname, 'shared'),
  '@app': resolve(__dirname, 'app'),
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
        input: { index: resolve(__dirname, 'app/preload/index.ts') }
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
