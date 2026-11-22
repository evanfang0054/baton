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
    'get_task_history',
    'get_task_failure',
    'create_task',
    'create_tasks',
    'plan_tasks',
    'batch_tasks',
    'decide_action',
    'enqueue_task',
    'retry_task',
    'reopen_task',
    'cancel_task',
    'reply_task',
    'handoff_task',
    'create_text',
    'create_agent',
    'create_edge',
    'update_node',
    'arrange_canvas',
    'inject_context',
  ],
  maxSteps: 4,
  timeoutMs: 60_000,
  maxOutputTokens: 2000,
}

/** 纯函数指纹，不依赖 Node crypto，避免 web 侧导入 core 时被打包进 polyfill。 */
export function supervisorShortHash(input: string): string {
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
  return supervisorShortHash(JSON.stringify({ ...policy, promptVersion })).slice(0, 12)
}
