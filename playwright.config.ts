import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/playwright",
  testMatch: /.*\.playwright\.ts$/,
  reporter: "list",
  retries: process.env.CI ? 2 : 0,
  webServer: {
    command: 'bun run --cwd apps/m-ui dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
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
