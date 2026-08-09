import { defineConfig } from "@playwright/test";

const e2ePort = 7878;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 1,
  use: { baseURL: e2eBaseUrl, trace: "retain-on-failure" },
});
