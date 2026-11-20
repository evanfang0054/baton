import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 这些用例需要启动 git / sqlite 子进程；CI 上并行执行时默认 5s 不够稳定。
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
