import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@app': resolve(__dirname, 'app'),
      '@protocols': resolve(__dirname, 'protocols'),
      '@renderer': resolve(__dirname, 'renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
