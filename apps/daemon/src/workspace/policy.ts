import { PolicySchema, type Policy } from '@baton/protocol'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { appError } from '../errors.js'

/**
 * 项目策略是任务执行的只读快照：缺失时用默认值，非法时拒绝任务创建。
 * 不把文件内容放进错误消息，避免把敏感配置带进日志/WS。
 */
export function loadPolicy(workspacePath: string): Policy {
  const file = join(workspacePath, '.baton', 'policy.json')
  if (!existsSync(file)) {
    return PolicySchema.parse({})
  }

  try {
    const realRoot = realpathSync(workspacePath)
    const real = realpathSync(file)
    if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) {
      throw new Error('policy escapes workspace')
    }
    return PolicySchema.parse(JSON.parse(readFileSync(real, 'utf8')))
  } catch {
    throw appError('invalid_policy', 'invalid .baton/policy.json')
  }
}
