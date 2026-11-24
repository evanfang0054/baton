import { isSensitivePath } from '@baton/core'
import type { Node } from '@baton/protocol'
import { readWorkspaceText } from './resolver.js'

export interface ContextContentInput {
  nodes: Node[]
  workspacePath: string
  /** 画板文字由上层注入 artifact 读取；读取失败返回「画板内容不可读」。 */
  readDrawingContent?: (artifactId: string) => string
}

/**
 * 预读 file 节点与画板文字；敏感路径在读取前跳过。
 * text/image 节点由 assembleContext 直接使用节点数据，不需要 IO。
 */
export function buildContextContent(input: ContextContentInput): {
  contentByNodeId: Record<string, string | null>
} {
  const contentByNodeId: Record<string, string | null> = {}
  for (const node of input.nodes) {
    if (node.type === 'file') {
      contentByNodeId[node.id] = isSensitivePath(node.data.path)
        ? null
        : readWorkspaceText(input.workspacePath, node.data.path)
      continue
    }
    if (node.type === 'drawing' && input.readDrawingContent) {
      try {
        contentByNodeId[node.id] = input.readDrawingContent(node.data.artifactId)
      } catch {
        contentByNodeId[node.id] = '画板内容不可读'
      }
    }
  }
  return { contentByNodeId }
}
