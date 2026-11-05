import { defineConfig } from "@playwright/test";

// Serves the production build with the generated fixture data copied to dist/data.
// PW_CHROMIUM may point at a preinstalled Chromium (the CI job installs its own).
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: "e2e",
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: "http://localhost:4173/", launchOptions: { executablePath } },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 }, isMobile: true } },
  ],
});
