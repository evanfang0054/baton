import { FakeAdapter } from '@baton/adapters'
import type { AgentAdapter, Engine } from '@baton/protocol'
import { appError } from '../errors.js'

export type AdapterFactory = (engine: Engine) => AgentAdapter

export function createAdapterFactory(
  overrides: Partial<Record<Engine, AgentAdapter>> = {},
): AdapterFactory {
  return (engine) => {
    const adapter = overrides[engine]
    if (adapter) {
      return adapter
    }
    if (engine === 'fake') {
      return new FakeAdapter()
    }
    throw appError('unsupported_engine', `engine ${engine} is not available in M1-5`, { engine })
  }
}
