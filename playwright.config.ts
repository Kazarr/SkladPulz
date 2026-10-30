import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:3199' },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning e2e/server.ts',
    url: 'http://localhost:3199/health',
    reuseExistingServer: false,
  },
});
