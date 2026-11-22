import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getAnnotation,
  getArtifact,
  getCanvasByDelivery,
  getDelivery,
  insertAnnotation,
  insertArtifact,
  insertDelivery,
  listArtifactsByDelivery,
  listDeliveries,
  setCanvasDelivery,
  updateAnnotation,
} from '../src/db/delivery-repositories.js'
import { createOrm, migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-delivery-'))
  dirs.push(dir)
  const raw = openDb(join(dir, 'baton.db'))
  migrateDb(raw)
  raw
    .prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)')
    .run('w1', 'demo', 'demo', 1)
  raw
    .prepare('insert into canvas (id, workspace_id, viewport_json) values (?, ?, ?)')
    .run('c1', 'w1', '{}')
  return { raw, db: createOrm(raw) }
}

describe('delivery repositories', () => {
  it('round-trips delivery, artifact and annotation', () => {
    const { raw, db } = setup()
    db.transaction((tx) => {
      insertDelivery(tx, {
        id: 'd1',
        workspaceId: 'w1',
        canvasId: 'c1',
        title: '优惠券领取页',
        goal: '做一个领取页',
        playbookId: 'standard-delivery',
        playbookVersion: 1,
        playbookJson: '{"id":"standard-delivery","version":1,"label":"标准交付","stages":[]}',
        createdAt: 1,
        updatedAt: 1,
        cancelledAt: null,
      })
      setCanvasDelivery(tx, 'c1', 'd1')
      insertArtifact(tx, {
        id: 'a1',
        workspaceId: 'w1',
        deliveryId: 'd1',
        stageKey: 'requirement',
        taskId: null,
        kind: 'spec',
        name: 'spec.md',
        path: '.baton/deliveries/d1/requirement/spec.md',
        sourcePath: null,
        svgPath: null,
        mime: 'text/markdown',
        size: 12,
        sha256: 'abc',
        version: 1,
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      })
      insertAnnotation(tx, {
        id: 'an1',
        workspaceId: 'w1',
        deliveryId: 'd1',
        stageKey: 'requirement',
        targetNodeIds: ['n1'],
        targetArtifactId: 'a1',
        note: '补充验收标准',
        strokesJson: '[]',
        bbox: { x: 0, y: 0, w: 10, h: 10 },
        imagePath: '.baton/deliveries/d1/requirement/annotations/an1.png',
        status: 'open',
        taskId: null,
        createdAt: 1,
        updatedAt: 1,
        resolvedAt: null,
      })
    })

    expect(getDelivery(db, 'd1')?.title).toBe('优惠券领取页')
    expect(getCanvasByDelivery(db, 'd1')?.id).toBe('c1')
    expect(getArtifact(db, 'a1')?.sha256).toBe('abc')
    expect(listArtifactsByDelivery(db, 'd1')).toHaveLength(1)
    expect(getAnnotation(db, 'an1')?.note).toBe('补充验收标准')
    expect(listDeliveries(db, 'w1')).toHaveLength(1)

    db.transaction((tx) => {
      updateAnnotation(tx, 'an1', { note: '改好了', status: 'resolved', updatedAt: 2 })
    })
    expect(getAnnotation(db, 'an1')).toMatchObject({ note: '改好了', status: 'resolved' })

    raw.close()
  })
})
