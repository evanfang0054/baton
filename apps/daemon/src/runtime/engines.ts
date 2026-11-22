import { claudeSdkMeta } from '@baton/adapters/claude-meta'
import type { Engine, EngineStatus } from '@baton/protocol'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface EngineRegistryDeps {
  env?: NodeJS.ProcessEnv
  home?: string
  now?: () => number
  sdkMeta?: () => { available: boolean; version: string | null }
}

export interface EngineRegistry {
  list(): EngineStatus[]
  get(engine: Engine): EngineStatus
  isAvailable(engine: Engine): boolean
}

const CACHE_MS = 30_000

/**
 * 只做轻量探测，不调用模型、不加载 SDK。
 * macOS 的 Keychain 登录态无法直接检查，因此保留 unknown 并允许尝试。
 */
export function createEngineRegistry(deps: EngineRegistryDeps = {}): EngineRegistry {
  const env = deps.env ?? process.env
  const home = deps.home ?? homedir()
  const now = deps.now ?? (() => Date.now())
  const sdkMeta = deps.sdkMeta ?? claudeSdkMeta
  let cached: { at: number; value: EngineStatus[] } | null = null

  function claudeStatus(): EngineStatus {
    const meta = sdkMeta()
    if (!meta.available) {
      return {
        engine: 'claude-sdk',
        status: 'unavailable',
        reason: 'Claude Agent SDK is not installed',
      }
    }
    if (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN) {
      return {
        engine: 'claude-sdk',
        status: 'available',
        reason: 'credential found in environment',
      }
    }
    if (existsSync(join(home, '.claude', '.credentials.json'))) {
      return { engine: 'claude-sdk', status: 'available', reason: 'Claude Code credentials found' }
    }
    return {
      engine: 'claude-sdk',
      status: 'unknown',
      reason: 'reusing local Claude Code login; Keychain cannot be probed',
    }
  }

  function compute(): EngineStatus[] {
    return [claudeStatus()]
  }

  function list(): EngineStatus[] {
    const at = now()
    if (!cached || at - cached.at >= CACHE_MS) {
      cached = { at, value: compute() }
    }
    return cached.value
  }

  function get(engine: Engine): EngineStatus {
    const found = list().find((entry) => entry.engine === engine)
    return found ?? { engine, status: 'unavailable', reason: 'engine is not supported in v1' }
  }

  return {
    list,
    get,
    isAvailable: (engine) => get(engine).status !== 'unavailable',
  }
}
