import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    conditions: ['browser']
  },
  test: {
    name: 'renderer',
    include: ['tests/renderer/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/renderer/setup.ts']
  }
})
