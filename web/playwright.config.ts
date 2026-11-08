import { defineConfig } from "@playwright/test";

// Serves the production build with the generated fixture data copied to dist/data.
// Port 4174 by default (4173 is the usual hand-run preview); an already-running server is reused
// only in CI-less runs when PW_REUSE=1, so a test run never lands on someone's preview.
// PW_CHROMIUM may point at a preinstalled Chromium (the CI job installs its own).
const executablePath = process.env.PW_CHROMIUM || undefined;

const port = Number(process.env.PW_PORT || 4174);

export default defineConfig({
  testDir: "e2e",
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI && process.env.PW_REUSE === "1",
  },
  use: { baseURL: `http://localhost:${port}/`, launchOptions: { executablePath } },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 }, isMobile: true } },
  ],
});
