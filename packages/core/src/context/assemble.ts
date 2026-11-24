import type {
  ContextDropped,
  ContextNodeRef,
  ContextRelation,
  Node,
  NodeType,
} from '@baton/protocol'
import { isSensitivePath } from './sensitive.js'
import type { AssembleContextInput, AssembleContextResult, DropReason } from './types.js'

const DEFAULT_MAX_CHARS = 48_000
const DEFAULT_MAX_NODE_CHARS = 16_384
const MAX_DEPTH = 2
const MAX_NODES = 40

/** 关系是内容之外的独立小预算；200 条是防御上限，4k 字符是实际约束。 */
export const RELATION_LIMITS = { maxEdges: 200, maxChars: 4_000 } as const

interface Candidate {
  node: Node
  depth: number
}

interface Rendered {
  node: Node
  depth: number
  content: string
  truncated: boolean
  chars: number
  seed: boolean
}

type ContentNode = Extract<Node, { type: 'text' | 'file' | 'image' | 'drawing' }>

function isContentNode(node: Node): node is ContentNode {
  return (
    node.type === 'text' || node.type === 'file' || node.type === 'image' || node.type === 'drawing'
  )
}

function compareNode(a: Node, b: Node): number {
  if (a.y !== b.y) return a.y - b.y
  if (a.x !== b.x) return a.x - b.x
  return compareText(a.id, b.id)
}

function compareNodeDesc(a: Node, b: Node): number {
  return -compareNode(a, b)
}

function compareCandidate(a: Candidate, b: Candidate): number {
  if (a.depth !== b.depth) return a.depth - b.depth
  return compareNode(a.node, b.node)
}

function titleOf(node: ContentNode): string {
  switch (node.type) {
    case 'text': {
      const first = node.data.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      return (first ?? 'text').slice(0, 60)
    }
    case 'file':
      return node.data.name
    case 'image':
      return node.data.alt ?? 'image'
    case 'drawing':
      return node.data.title
  }
}

function nodeTitle(node: Node): string {
  switch (node.type) {
    case 'text':
    case 'file':
    case 'image':
      return titleOf(node)
    case 'agent':
      return node.data.title
    case 'group':
      return node.data.label
    case 'review':
      return 'review'
    case 'artifact':
      return node.data.title
    case 'drawing':
      return node.data.title
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function renderContent(
  node: ContentNode,
  contentByNodeId: Readonly<Record<string, string | null>> | undefined,
): string {
  switch (node.type) {
    case 'text':
      return node.data.content
    case 'file': {
      const content =
        contentByNodeId && Object.hasOwn(contentByNodeId, node.id)
          ? contentByNodeId[node.id]
          : undefined
      return content === undefined || content === null ? node.data.path : content
    }
    case 'image': {
      const alt = node.data.alt ? ` alt="${escapeAttr(node.data.alt)}"` : ''
      return `<image src="${escapeAttr(node.data.src)}"${alt}/>`
    }
    case 'drawing': {
      const content =
        contentByNodeId && Object.hasOwn(contentByNodeId, node.id)
          ? contentByNodeId[node.id]
          : undefined
      const text = content?.trim()
      return text && text.length > 0 ? text : `[画板] ${node.data.title}`
    }
  }
}

function drop(map: Map<string, DropReason>, id: string, reason: DropReason): void {
  if (!map.has(id)) map.set(id, reason)
}

export interface AssemblePayload {
  body: string
  included: ContextNodeRef[]
  dropped: ContextDropped[]
  truncated: boolean
  redactedPaths: string[]
  relations: ContextRelation[]
  relationsTruncated: boolean
  relationLines: string[]
  truncatedIds: string[]
}

/**
 * 确定性上下文装配：不读文件、不访问时间/随机数，同一输入必须逐字节相同。
 * 调用方负责把文件内容预读进 contentByNodeId；敏感路径在读取前也要再判一次。
 */
export function assemblePayload(input: AssembleContextInput): AssemblePayload {
  const maxChars = Math.max(0, input.maxChars ?? DEFAULT_MAX_CHARS)
  const maxNodeChars = Math.max(0, input.maxNodeChars ?? DEFAULT_MAX_NODE_CHARS)
  const byId = new Map(input.nodes.map((node) => [node.id, node]))
  const incoming = new Map<string, string[]>()

  for (const edge of input.edges) {
    if (edge.type !== 'context') continue
    const list = incoming.get(edge.targetId)
    if (list) list.push(edge.sourceId)
    else incoming.set(edge.targetId, [edge.sourceId])
  }

  const dropped = new Map<string, DropReason>()
  const redactedPaths: string[] = []
  const seedIds = new Set<string>()

  const addSeed = (id: string): void => {
    const node = byId.get(id)
    if (!node) {
      drop(dropped, id, 'not_found')
      return
    }
    if (node.id === input.targetNodeId) {
      drop(dropped, id, 'target')
      return
    }
    if (node.type === 'group') {
      for (const child of input.nodes) {
        if (child.groupId !== node.id) continue
        if (child.id === input.targetNodeId) {
          drop(dropped, child.id, 'target')
          continue
        }
        // group 只展开内容节点；agent/review/嵌套 group 不是内容源。
        if (isContentNode(child)) seedIds.add(child.id)
      }
      return
    }
    if (!isContentNode(node)) return
    seedIds.add(id)
  }

  for (const id of input.selectedNodeIds) addSeed(id)

  // 直接连到目标 Agent 的 context 边是硬依赖，即使没有框选也要注入。
  for (const id of incoming.get(input.targetNodeId) ?? []) {
    const node = byId.get(id)
    if (!node) {
      drop(dropped, id, 'not_found')
      continue
    }
    if (!isContentNode(node)) continue
    seedIds.add(id)
  }

  const depth = new Map<string, number>()
  const queue: string[] = []
  for (const id of seedIds) {
    depth.set(id, 0)
    queue.push(id)
  }

  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]!
    const currentDepth = depth.get(id)!
    if (currentDepth >= MAX_DEPTH) continue
    for (const predecessor of incoming.get(id) ?? []) {
      if (depth.has(predecessor)) continue
      const predecessorNode = byId.get(predecessor)
      if (!predecessorNode) {
        drop(dropped, predecessor, 'not_found')
        continue
      }
      if (predecessorNode.id === input.targetNodeId || !isContentNode(predecessorNode)) {
        continue
      }
      depth.set(predecessor, currentDepth + 1)
      queue.push(predecessor)
    }
  }

  const candidates: Candidate[] = []
  for (const [id, nodeDepth] of depth) {
    const node = byId.get(id)
    if (node) candidates.push({ node, depth: nodeDepth })
  }
  candidates.sort(compareCandidate)

  for (const extra of candidates.slice(MAX_NODES)) {
    drop(dropped, extra.node.id, 'limit')
  }

  const truncatedIds = new Set<string>()
  const rendered: Rendered[] = []
  for (const { node, depth: nodeDepth } of candidates.slice(0, MAX_NODES)) {
    if (node.type === 'file' && isSensitivePath(node.data.path)) {
      drop(dropped, node.id, 'sensitive')
      if (!redactedPaths.includes(node.data.path)) redactedPaths.push(node.data.path)
      continue
    }

    // addSeed/BFS 已排除 agent/review/group，这里只可能是文本/文件/图片。
    const contentNode = node as ContentNode
    const raw = renderContent(contentNode, input.contentByNodeId)
    if (raw.trim().length === 0) {
      drop(dropped, node.id, 'empty')
      continue
    }

    const wasTruncated = raw.length > maxNodeChars
    const content = wasTruncated ? raw.slice(0, maxNodeChars) : raw
    if (content.length === 0) {
      drop(dropped, node.id, 'empty')
      if (wasTruncated) truncatedIds.add(node.id)
      continue
    }
    rendered.push({
      node,
      depth: nodeDepth,
      content,
      truncated: wasTruncated,
      chars: content.length,
      seed: seedIds.has(node.id),
    })
  }

  let total = rendered.reduce((sum, item) => sum + item.chars, 0)

  if (total > maxChars) {
    const dropOrder = rendered
      .filter((item) => !item.seed)
      .sort((a, b) => b.depth - a.depth || compareNodeDesc(a.node, b.node))

    for (const item of dropOrder) {
      if (total <= maxChars) break
      const index = rendered.indexOf(item)
      if (index < 0) continue
      rendered.splice(index, 1)
      total -= item.chars
      drop(dropped, item.node.id, 'budget')
      truncatedIds.add(item.node.id)
    }

    // 显式节点/硬依赖最后才硬截断；从排序最靠后的开始。
    while (total > maxChars) {
      const seeds = rendered
        .filter((item) => item.seed)
        .sort((a, b) => compareNodeDesc(a.node, b.node))
      const last = seeds[0]
      if (!last) break

      const allowed = Math.max(0, maxChars - (total - last.chars))
      const index = rendered.indexOf(last)

      if (allowed <= 0) {
        rendered.splice(index, 1)
        total -= last.chars
        drop(dropped, last.node.id, 'budget')
        truncatedIds.add(last.node.id)
        continue
      }

      if (allowed < last.content.length) {
        last.content = last.content.slice(0, allowed)
        total = total - last.chars + allowed
        last.chars = allowed
        last.truncated = true
        truncatedIds.add(last.node.id)
        continue
      }

      break
    }
  }

  const truncated = truncatedIds.size > 0 || rendered.some((item) => item.truncated)

  const body = rendered
    .map((item) => {
      const attributes =
        `id="${escapeAttr(item.node.id)}" type="${item.node.type}" ` +
        `title="${escapeAttr(nodeTitle(item.node))}"`
      const mark = item.truncated ? ' truncated="true"' : ''
      return `<node ${attributes}${mark}>${item.content}</node>`
    })
    .join('\n')

  const includedIds = new Set(rendered.map((item) => item.node.id))
  const relationScope = new Set([...includedIds, input.targetNodeId])
  const relationCandidates: ContextRelation[] = input.edges
    .filter((edge) => relationScope.has(edge.sourceId) || relationScope.has(edge.targetId))
    .flatMap((edge) => {
      const from = byId.get(edge.sourceId)
      const to = byId.get(edge.targetId)
      if (!from || !to) return []
      return [
        {
          from: edge.sourceId,
          to: edge.targetId,
          type: edge.type,
          fromTitle: nodeTitle(from),
          toTitle: nodeTitle(to),
          includedFrom: includedIds.has(edge.sourceId),
          includedTo: includedIds.has(edge.targetId),
        } satisfies ContextRelation,
      ]
    })
    .sort((a, b) => {
      const priority =
        Number(!(a.includedFrom && a.includedTo)) - Number(!(b.includedFrom && b.includedTo))
      return (
        priority ||
        compareText(a.from, b.from) ||
        compareText(a.to, b.to) ||
        compareText(a.type, b.type)
      )
    })

  const relationLines: string[] = []
  const renderedRelations: ContextRelation[] = []
  let relationChars = 0
  let relationsTruncated = false

  for (const relation of relationCandidates) {
    const line =
      `<edge from="${escapeAttr(relation.from)}" to="${escapeAttr(relation.to)}" ` +
      `type="${relation.type}" from_title="${escapeAttr(relation.fromTitle)}" ` +
      `to_title="${escapeAttr(relation.toTitle)}"/>`
    if (
      renderedRelations.length >= RELATION_LIMITS.maxEdges ||
      relationChars + line.length > RELATION_LIMITS.maxChars
    ) {
      relationsTruncated = true
      break
    }
    relationLines.push(line)
    renderedRelations.push(relation)
    relationChars += line.length
  }

  const included: ContextNodeRef[] = rendered.map((item) => ({
    id: item.node.id,
    type: item.node.type as NodeType,
    title: nodeTitle(item.node),
    depth: item.depth,
    chars: item.chars,
  }))

  const droppedList = [...dropped.entries()]
    .map(([id, reason]) => {
      const node = byId.get(id)
      return { id, reason, ...(node ? { title: nodeTitle(node) } : {}) }
    })
    .sort((a, b) => compareText(a.id, b.id))

  return {
    body,
    included,
    dropped: droppedList,
    truncated,
    redactedPaths,
    relations: renderedRelations,
    relationsTruncated,
    relationLines,
    truncatedIds: [...truncatedIds].sort(),
  }
}

/** 输出必须与重构前逐字节一致；旧快照测试是这条契约的回归门。 */
export function assembleContext(input: AssembleContextInput): AssembleContextResult {
  const payload = assemblePayload(input)
  const parts = [
    `<task>${input.taskPrompt}</task>`,
    `<context>${payload.body.length > 0 ? `\n${payload.body}\n` : ''}</context>`,
  ]

  if (payload.relationLines.length > 0) {
    const attr = payload.relationsTruncated ? ' truncated="true"' : ''
    parts.push(`<relations${attr}>\n${payload.relationLines.join('\n')}\n</relations>`)
  }

  if (payload.truncatedIds.length > 0) {
    parts.push(`<truncated nodes="${escapeAttr(payload.truncatedIds.join(','))}"/>`)
  }

  return {
    prompt: parts.join('\n'),
    included: payload.included,
    dropped: payload.dropped,
    truncated: payload.truncated,
    redactedPaths: payload.redactedPaths,
    relations: payload.relations,
    relationsTruncated: payload.relationsTruncated,
  }
}
