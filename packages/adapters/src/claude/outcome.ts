/**
 * systemPrompt 追加片段：把 outcome 上报变成模型每轮结束前的硬约束。
 * 不在提示里重复 baton 的权限策略，避免模型自行解释或绕过。
 */
export const BATON_PROTOCOL_PROMPT = [
  '<baton_protocol>',
  'Before ending a turn, you MUST call the MCP tool baton_report exactly once for that turn.',
  'Use outcome "ready" when the task is complete and ready for verify.',
  'Use outcome "blocked" when you need the user to answer or decide; include a short reason.',
  'Use outcome "dropped" when the work should not be done; include a short reason.',
  'Do not end a turn without reporting.',
  '</baton_protocol>',
].join('\n')
