import type { Edge, Node, NodeType } from '@baton/protocol'

export interface AssembleContextInput {
  taskPrompt: string
  targetNodeId: string
  selectedNodeIds: string[]
  nodes: Node[]
  edges: Edge[]
  /** 调用方预读的文件内容；key 为 node id；null 表示已判定不可读。 */
  contentByNodeId?: Readonly<Record<string, string | null>>
  maxChars?: number
  maxNodeChars?: number
}

export type DropReason = 'budget' | 'sensitive' | 'limit' | 'not_found' | 'target' | 'empty'

export interface AssembleContextResult {
  prompt: string
  included: Array<{ id: string; type: NodeType; depth: number; chars: number }>
  dropped: Array<{ id: string; reason: DropReason }>
  truncated: boolean
  redactedPaths: string[]
}
