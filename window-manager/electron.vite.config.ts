import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          assistedWindowWorker: resolve(__dirname, 'src/main/assistedWindowWorker.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [svelte()],
    server: {
      port: 5174
    }
  }
})
