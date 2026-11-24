import type { TaskTemplate } from '@baton/protocol'

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'bugfix',
    label: '修复',
    titlePattern: '修复：{goal}',
    acceptanceSeed: ['复现步骤可执行', '失败现象消失', '相关回归点通过'],
    contextRules: {
      includeSameAgent: true,
      includeHandoffChain: false,
      includeRecentFailures: true,
      maxContextNodes: 5,
    },
    defaultEngine: null,
  },
  {
    id: 'feature',
    label: '实现',
    titlePattern: '实现：{goal}',
    acceptanceSeed: ['功能点按描述可用', '边界条件有测试', '现有行为不回归'],
    contextRules: {
      includeSameAgent: true,
      includeHandoffChain: true,
      includeRecentFailures: false,
      maxContextNodes: 5,
    },
    defaultEngine: null,
  },
  {
    id: 'review',
    label: '审查',
    titlePattern: '审查：{goal}',
    acceptanceSeed: ['改动范围清楚', '风险点有结论', '验证方式可执行'],
    contextRules: {
      includeSameAgent: false,
      includeHandoffChain: false,
      includeRecentFailures: false,
      maxContextNodes: 5,
    },
    defaultEngine: null,
  },
  {
    id: 'handoff',
    label: '交接',
    titlePattern: '交接：{goal}',
    acceptanceSeed: ['A 的结果可被 B 消费', '交接上下文完整', '后续任务可独立开工'],
    contextRules: {
      includeSameAgent: false,
      includeHandoffChain: true,
      includeRecentFailures: false,
      maxContextNodes: 5,
    },
    defaultEngine: null,
  },
]

export function templateById(id: string | null): TaskTemplate | null {
  return TASK_TEMPLATES.find((template) => template.id === id) ?? null
}

export function matchTemplate(intent: string): TaskTemplate['id'] | null {
  const text = intent.toLowerCase()
  if (/修复|bug|错误|崩溃|失败/.test(text)) return 'bugfix'
  if (/审查|review|检查|风险/.test(text)) return 'review'
  if (/交接|handoff|接着做|继续/.test(text)) return 'handoff'
  if (/实现|新增|功能|feature/.test(text)) return 'feature'
  return null
}
