import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@app': resolve(__dirname, 'app'),
      '@protocols/index': resolve(__dirname, 'protocols/index.ts'),
      '@protocols': resolve(__dirname, 'protocols'),
      '@app/index': resolve(__dirname, 'app/index.ts'),
      '@renderer': resolve(__dirname, 'renderer/src'),
      '@server': resolve(__dirname, 'server')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
