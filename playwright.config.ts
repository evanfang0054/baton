import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './apps/web/e2e',
  // 画布拖拽偶发受 headless 帧调度影响；失败重试一次，避免假红。
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    // 不下载 Playwright 自带 Chromium：优先用系统 Chrome（CI runner 也预装）。
    // 需要指定其他浏览器时用 PLAYWRIGHT_EXECUTABLE_PATH。
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  },
  webServer: {
    command:
      'pnpm --filter @baton/web build && pnpm --filter @baton/web preview --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
