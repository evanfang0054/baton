import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createArtifactService } from '../src/artifact/service.js'
import { createDeliveryService } from '../src/delivery/service.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: Array<ReturnType<typeof createTestRuntime>> = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

function setup() {
  const handle = createTestRuntime()
  handles.push(handle)
  const deliveries = createDeliveryService({
    db: handle.database.db,
    config: handle.config,
    now: handle.now,
    newId: handle.newId,
  })
  const artifacts = createArtifactService({
    db: handle.database.db,
    config: handle.config,
    now: handle.now,
    newId: handle.newId,
  })
  const created = deliveries.createDelivery({
    workspaceId: handle.seeded.workspaceId,
    title: '优惠券领取页',
    goal: '做一个领取页',
  })
  if (!created.ok) throw new Error(created.message)
  return { handle, deliveries, artifacts, deliveryId: created.deliveryId }
}

describe('artifact service', () => {
  it('fails required artifacts when missing and records them when present', () => {
    const { handle, artifacts, deliveryId } = setup()
    expect(artifacts.checkRequiredArtifacts(deliveryId, 'requirement')).toEqual({
      ok: false,
      missing: ['spec.md'],
    })

    const path = join(
      handle.root,
      handle.seeded.relPath,
      '.baton',
      'deliveries',
      deliveryId,
      'requirement',
      'spec.md',
    )
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '# 需求\n')

    const result = artifacts.checkRequiredArtifacts(deliveryId, 'requirement')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.artifacts[0]).toMatchObject({ name: 'spec.md', status: 'ready' })
      expect(result.artifacts[0]?.sha256).toHaveLength(64)
    }
  })

  it('saves and reads drawing content', () => {
    const { artifacts, deliveryId } = setup()
    const draft = artifacts.createDraftArtifact({
      deliveryId,
      stageKey: 'design',
      kind: 'drawing',
      name: 'wireframe.png',
    })
    const saved = artifacts.saveArtifactContent({
      artifactId: draft.id,
      previewBase64: Buffer.from('hello').toString('base64'),
      sourceBase64: Buffer.from('{"type":"excalidraw"}').toString('base64'),
    })
    expect(saved.status).toBe('ready')
    expect(artifacts.readArtifactContent(draft.id).data.toString()).toBe('hello')
  })
})
