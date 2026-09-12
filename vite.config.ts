import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', qpcr: 'qpcr/index.html' } } },
  test: { include: ['src/**/*.test.ts'] },
  server: { port: 5176, strictPort: true },
})
