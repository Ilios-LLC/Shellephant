import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'main',
    include: ['tests/main/**/*.test.ts'],
    environment: 'node',
    globals: true,
  }
})
