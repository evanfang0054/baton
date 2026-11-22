import type { AgentAdapter, Engine } from '@baton/protocol'
import { appError } from '../errors.js'

export type AdapterFactory = (engine: Engine) => AgentAdapter | Promise<AgentAdapter>

export interface AdapterFactoryOptions {
  maxTurns?: number
  maxBudgetUsd?: number
  projectHooksGlobal?: boolean
}

/**
 * Claude adapter 动态加载：daemon 启动与 CI 测试都不 eager import SDK。
 * 真实 SDK 的加载失败会以 engine_unavailable 回给调用方，而不是拖垮 daemon。
 */
export function createAdapterFactory(
  overrides: Partial<Record<Engine, AgentAdapter>> = {},
  options: AdapterFactoryOptions = {},
): AdapterFactory {
  let claude: AgentAdapter | null = null

  return async (engine) => {
    const adapter = overrides[engine]
    if (adapter) {
      return adapter
    }
    if (engine === 'claude-sdk') {
      if (!claude) {
        try {
          const { ClaudeAdapter } = await import('@baton/adapters/claude')
          claude = new ClaudeAdapter({
            ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}),
            ...(options.maxBudgetUsd ? { maxBudgetUsd: options.maxBudgetUsd } : {}),
            ...(options.projectHooksGlobal !== undefined
              ? { projectHooksGlobal: options.projectHooksGlobal }
              : {}),
          })
        } catch {
          throw appError('engine_unavailable', 'Claude Agent SDK is not available', { engine })
        }
      }
      return claude
    }
    throw appError('unsupported_engine', `engine ${engine} is not available in v1`, { engine })
  }
}
