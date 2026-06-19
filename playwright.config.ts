import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/playwright",
  reporter: "list",
  retries: process.env.CI ? 2 : 0,
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    trace: "on-first-retry",
    ...(executablePath
      ? {
          launchOptions: {
            executablePath,
          },
        }
      : {}),
  },
});
