// E2E smoke tests: the five key pages render and their core interactions
// work against the real production bundle (vite preview serves build/).
// Run: npm run build && npm run e2e
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 45000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'npm run preview',
    port: 3000,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
