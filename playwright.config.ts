import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5176',
    viewport: { width: 1600, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
})
