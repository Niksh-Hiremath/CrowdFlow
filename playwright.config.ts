import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:7860/api/health",
    reuseExistingServer: true,
    timeout: 120000
  }
});
