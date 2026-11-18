import type {
  ContextDropped,
  ContextNodeRef,
  ContextRelation,
  DropReason,
  Edge,
  Node,
} from '@baton/protocol'

export type { DropReason }

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

export interface AssembleContextResult {
  prompt: string
  included: ContextNodeRef[]
  dropped: ContextDropped[]
  truncated: boolean
  redactedPaths: string[]
  relations: ContextRelation[]
  relationsTruncated: boolean
}
