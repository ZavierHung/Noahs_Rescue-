import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const systemChrome =
  process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    channel: process.env.PLAYWRIGHT_CHANNEL || (systemChrome ? "chrome" : undefined),
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:web",
    url: "http://localhost:3000/mobile",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
