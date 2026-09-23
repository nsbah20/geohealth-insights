import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const localChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions:
          !process.env.CI && existsSync(localChrome)
            ? { executablePath: localChrome }
            : undefined,
      },
    },
  ],
});
