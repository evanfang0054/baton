import type { Node } from '@baton/protocol'

export function nodeTitle(node: Node): string {
  switch (node.type) {
    case 'text': {
      const first = node.data.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      return (first ?? '文本节点').slice(0, 60)
    }
    case 'file':
      return node.data.name
    case 'image':
      return node.data.alt ?? '图片'
    case 'agent':
      return node.data.title
    case 'group':
      return node.data.label
    case 'review':
      return '验收节点'
  }
}
