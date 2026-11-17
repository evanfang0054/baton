import { isSensitivePath } from '@baton/core'
import type { Node } from '@baton/protocol'
import { readWorkspaceText } from './resolver.js'

export interface ContextContentInput {
  nodes: Node[]
  workspacePath: string
}

/**
 * 只预读 file 节点；敏感路径在读取前跳过。
 * text/image 节点由 assembleContext 直接使用节点数据，不需要 IO。
 */
export function buildContextContent(input: ContextContentInput): {
  contentByNodeId: Record<string, string | null>
} {
  const contentByNodeId: Record<string, string | null> = {}
  for (const node of input.nodes) {
    if (node.type !== 'file') continue
    contentByNodeId[node.id] = isSensitivePath(node.data.path)
      ? null
      : readWorkspaceText(input.workspacePath, node.data.path)
  }
  return { contentByNodeId }
}
