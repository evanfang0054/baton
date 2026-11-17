/**
 * verify 子进程不应继承 baton 的凭据与模型 API key。
 * 保留 PATH/HOME/SHELL 等运行必需项，其余匹配敏感词的键一律剔除。
 */
export function sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue
    }
    if (key.startsWith('BATON_')) {
      continue
    }
    if (key === 'ANTHROPIC_API_KEY') {
      continue
    }
    if (/token|secret|authorization|api[_-]?key/i.test(key)) {
      continue
    }
    safe[key] = value
  }
  return safe
}
