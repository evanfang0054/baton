import type { Node } from '@baton/protocol'
import { xmlEscape } from './xml.js'

const OVERVIEW_LIMIT = 20
const TEXT_PREVIEW = 200

export function textTitle(content: string): string {
  return (
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0)
      ?.slice(0, 60) ?? 'text'
  )
}

export function nodeTitle(node: Node): string {
  switch (node.type) {
    case 'text':
      return textTitle(node.data.content)
    case 'file':
      return node.data.name
    case 'image':
      return node.data.alt ?? 'image'
    case 'agent':
      return node.data.title
    case 'group':
      return node.data.label
    case 'review':
      return 'review'
  }
}

/** 总管只拿画布摘要；文本节点给预览，文件节点只给名称与路径，不读文件内容。 */
export function nodeSummary(node: Node): Record<string, unknown> {
  const base = {
    id: node.id,
    type: node.type,
    title: nodeTitle(node),
    groupId: node.groupId,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
  }
  switch (node.type) {
    case 'text':
      return { ...base, preview: node.data.content.slice(0, TEXT_PREVIEW) }
    case 'file':
      return { ...base, path: node.data.path, mime: node.data.mime ?? null }
    case 'agent':
      return { ...base, engine: node.data.engine, taskId: node.data.taskId }
    case 'group':
      return { ...base, collapsed: node.data.collapsed }
    case 'review':
      return { ...base, taskId: node.data.taskId }
    case 'image':
      return base
  }
}

/** 候选卡里的固定摘要，保证总管不调工具也知道画布大致有什么。 */
export function canvasOverviewXml(nodes: Node[], edgeCount: number): string {
  const shown = nodes.slice(0, OVERVIEW_LIMIT)
  const lines = shown.map((node) => {
    const attrs = [
      `id="${xmlEscape(node.id)}"`,
      `type="${node.type}"`,
      `title="${xmlEscape(nodeTitle(node))}"`,
    ]
    if (node.type === 'agent') {
      attrs.push(`engine="${node.data.engine}"`)
      attrs.push(`taskId="${xmlEscape(node.data.taskId ?? '')}"`)
    }
    return `  <node ${attrs.join(' ')} />`
  })
  const attributes = [
    `total="${nodes.length}"`,
    `edges="${edgeCount}"`,
    `shown="${shown.length}"`,
    `truncated="${nodes.length > shown.length}"`,
  ].join(' ')
  return [`<canvas_overview ${attributes}>`, ...lines, '</canvas_overview>'].join('\n')
}
