import type { Node } from '@baton/protocol'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildContextContent } from '../src/workspace/context.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-context-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

const base = {
  canvasId: 'c1',
  x: 0,
  y: 0,
  w: 320,
  h: 200,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
} as const

describe('buildContextContent', () => {
  it('reads file nodes and skips sensitive, binary and missing files', () => {
    const root = tempDir()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'app.ts'), 'export const app = 1\n')
    writeFileSync(join(root, '.env'), 'SECRET=1\n')
    writeFileSync(join(root, 'image.png'), 'not really an image')

    const nodes: Node[] = [
      { ...base, id: 'text-1', type: 'text', data: { content: 'hello' } },
      {
        ...base,
        id: 'file-1',
        type: 'file',
        data: { path: 'src/app.ts', name: 'app.ts' },
      },
      { ...base, id: 'file-2', type: 'file', data: { path: '.env', name: '.env' } },
      {
        ...base,
        id: 'file-3',
        type: 'file',
        data: { path: 'image.png', name: 'image.png' },
      },
      {
        ...base,
        id: 'file-4',
        type: 'file',
        data: { path: 'missing.txt', name: 'missing.txt' },
      },
    ]

    const { contentByNodeId } = buildContextContent({ nodes, workspacePath: root })
    expect(contentByNodeId['file-1']).toContain('export const app')
    expect(contentByNodeId['file-2']).toBeNull()
    expect(contentByNodeId['file-3']).toBeNull()
    expect(contentByNodeId['file-4']).toBeNull()
    expect(contentByNodeId['text-1']).toBeUndefined()
  })

  it('pre-reads drawing text and marks unreadable drawings', () => {
    const root = tempDir()
    const nodes: Node[] = [
      {
        ...base,
        id: 'drawing-1',
        type: 'drawing',
        data: { artifactId: 'a1', title: '流程草图', status: 'ready' },
      },
      {
        ...base,
        id: 'drawing-2',
        type: 'drawing',
        data: { artifactId: 'a2', title: '坏画板', status: 'ready' },
      },
    ]
    const { contentByNodeId } = buildContextContent({
      nodes,
      workspacePath: root,
      readDrawingContent: (artifactId) => {
        if (artifactId === 'a2') throw new Error('broken scene')
        return '入口 → 支付'
      },
    })
    expect(contentByNodeId['drawing-1']).toBe('入口 → 支付')
    expect(contentByNodeId['drawing-2']).toBe('画板内容不可读')
  })
})
