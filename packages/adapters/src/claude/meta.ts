import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/**
 * 轻量元信息：只解析 SDK package.json，不加载 SDK 本体。
 * daemon 用它做可用性探测，避免启动时 eager import 大模块。
 */
export function claudeSdkMeta(): { available: boolean; version: string | null } {
  try {
    const entry = require.resolve('@anthropic-ai/claude-agent-sdk/core')
    const pkg = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')) as {
      version?: unknown
    }
    return {
      available: true,
      version: typeof pkg.version === 'string' ? pkg.version : null,
    }
  } catch {
    return { available: false, version: null }
  }
}
