import { PolicySchema, type Policy } from '@baton/protocol'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, sep } from 'node:path'
import { hashPolicy } from '../automation/version.js'
import { appError } from '../errors.js'
import { resolveWithin } from './resolver.js'

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

/**
 * UI 只改三个字段，但落盘必须完整 policy；调用方负责 merge。
 * 目录与目标文件都走 workspace jail，防止 `.baton` 软链逃逸。
 */
export function writePolicy(workspacePath: string, policy: Policy): { policyVersion: string } {
  let temp: string | null = null
  try {
    const parsed = PolicySchema.parse(policy)
    const batonDir = resolveWithin(workspacePath, '.baton')
    mkdirSync(batonDir, { recursive: true })
    const realRoot = realpathSync(workspacePath)
    const realDir = realpathSync(batonDir)
    if (realDir !== realRoot && !realDir.startsWith(`${realRoot}${sep}`)) {
      throw new Error('policy directory escapes workspace')
    }
    temp = join(realDir, `.policy.${process.pid}.${Date.now()}.tmp`)
    writeFileSync(temp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temp, join(realDir, 'policy.json'))
    return { policyVersion: hashPolicy(parsed) }
  } catch {
    if (temp) rmSync(temp, { force: true })
    throw appError('policy_write_failed', 'cannot write .baton/policy.json')
  }
}
