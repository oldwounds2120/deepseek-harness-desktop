import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // electron-updater 是运行时依赖，保持 external
        external: ['electron-updater']
      }
    }
  },
  preload: {},
  renderer: {
    build: {
      rollupOptions: {
        input: {
          gate: resolve(__dirname, 'src/renderer/gate.html')
        }
      }
    }
  }
})
