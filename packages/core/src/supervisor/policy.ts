export interface SupervisorPolicy {
  mode: 'explicit' | 'observe' | 'auto'
  allowedTools: readonly string[]
  maxSteps: number
  timeoutMs: number
  maxOutputTokens: number
}

export const SUPERVISOR_POLICY: SupervisorPolicy = {
  mode: 'explicit',
  allowedTools: [
    'list_canvas',
    'list_tasks',
    'get_task',
    'create_task',
    'enqueue_task',
    'create_text',
    'create_agent',
    'create_edge',
  ],
  maxSteps: 4,
  timeoutMs: 60_000,
  maxOutputTokens: 2000,
}

/** 纯函数指纹，不依赖 Node crypto，避免 web 侧导入 core 时被打包进 polyfill。 */
function shortHash(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= code + index
    h2 = Math.imul(h2, 0x85ebca6b)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

export function supervisorPolicyVersion(policy: SupervisorPolicy, promptVersion: string): string {
  return shortHash(JSON.stringify({ ...policy, promptVersion })).slice(0, 12)
}
