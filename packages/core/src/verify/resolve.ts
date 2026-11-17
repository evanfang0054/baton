import type { VerifyCommandInput, VerifyCommandResult } from './types.js'

function invalid(message: string): VerifyCommandResult {
  return { ok: false, error: { code: 'invalid_payload', message } }
}

/**
 * 只解析，不执行。命令不存在或不可执行由 M1-5 的 verify executor 处理，
 * 并进入 review 让用户看到失败证据。
 */
export function resolveVerifyCommand(input: VerifyCommandInput): VerifyCommandResult {
  const task = input.taskCommand?.trim()
  if (input.taskCommand !== undefined && task === '') {
    return invalid('task verify command cannot be empty')
  }
  if (task) return { ok: true, command: task, source: 'task' }

  const policy = input.policyCommand?.trim()
  if (input.policyCommand !== undefined && policy === '') {
    return invalid('policy verify command cannot be empty')
  }
  if (policy) return { ok: true, command: policy, source: 'policy' }

  const script = input.packageScripts?.verify?.trim()
  if (script) {
    const manager = input.packageManager ?? 'pnpm'
    return { ok: true, command: `${manager} run verify`, source: 'package' }
  }

  return { ok: true, command: 'pnpm test', source: 'fallback' }
}
