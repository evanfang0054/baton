import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createAttentionService } from '../src/attention/service.js'
import { insertAcceptanceContract, insertAcceptanceItems } from '../src/db/acceptance-repository.js'
import { insertDelivery } from '../src/db/delivery-repositories.js'
import type { Db } from '../src/db/types.js'
import { createTestDb, seedTask, type TestDb } from './helpers/db.js'

function addDelivery(database: TestDb, workspaceId: string, title: string, now: number): string {
  const canvasId = randomUUID()
  database.raw
    .prepare('insert into canvas (id, workspace_id, viewport_json) values (?, ?, ?)')
    .run(canvasId, workspaceId, JSON.stringify({ x: 0, y: 0, zoom: 1 }))
  const deliveryId = randomUUID()
  database.db.transaction((tx) =>
    insertDelivery(tx, {
      id: deliveryId,
      workspaceId,
      canvasId,
      title,
      goal: '',
      playbookId: 'standard-delivery',
      playbookVersion: 1,
      playbookJson: '{}',
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
    }),
  )
  return deliveryId
}

function markTask(
  database: TestDb,
  taskId: string,
  patch: {
    deliveryId?: string | null
    stageKey?: string | null
    status: string
    waitingReason?: string | null
    updatedAt: number
  },
): void {
  database.raw
    .prepare(
      `update task
       set delivery_id = ?, stage_key = ?, status = ?, waiting_reason = ?, updated_at = ?
       where id = ?`,
    )
    .run(
      patch.deliveryId ?? null,
      patch.stageKey ?? null,
      patch.status,
      patch.waitingReason ?? null,
      patch.updatedAt,
      taskId,
    )
}

function service(db: Db) {
  return createAttentionService({ db, now: () => 100 })
}

describe('attention service', () => {
  it('returns delivery-bound person tasks ordered by waitingSince', () => {
    const database = createTestDb()
    const workspaceA = seedTask(database.raw, { now: 1 })
    const workspaceB = seedTask(database.raw, { now: 2 })
    const deliveryA = addDelivery(database, workspaceA.workspaceId, '需求 A', 1)
    const deliveryB = addDelivery(database, workspaceB.workspaceId, '需求 B', 2)

    markTask(database, workspaceA.taskId, {
      deliveryId: deliveryA,
      stageKey: 'requirement',
      status: 'waiting_input',
      waitingReason: 'question',
      updatedAt: 30,
    })
    markTask(database, workspaceB.taskId, {
      deliveryId: deliveryB,
      stageKey: 'design',
      status: 'review',
      updatedAt: 10,
    })

    const unbound = seedTask(database.raw, { now: 3 })
    markTask(database, unbound.taskId, { status: 'review', updatedAt: 1 })

    const done = seedTask(database.raw, { now: 4 })
    const deliveryDone = addDelivery(database, done.workspaceId, '已完成', 4)
    markTask(database, done.taskId, {
      deliveryId: deliveryDone,
      stageKey: 'acceptance',
      status: 'done',
      updatedAt: 1,
    })

    const items = service(database.db).list(20).items
    expect(items.map((item) => item.taskId)).toEqual([workspaceB.taskId, workspaceA.taskId])
    expect(items[0]).toMatchObject({
      workspaceId: workspaceB.workspaceId,
      workspaceName: 'demo',
      deliveryId: deliveryB,
      deliveryTitle: '需求 B',
      stageKey: 'design',
      kind: 'needs_review',
      waitingSince: 10,
    })
    expect(items[1]).toMatchObject({
      deliveryId: deliveryA,
      deliveryTitle: '需求 A',
      kind: 'needs_reply',
      waitingSince: 30,
    })
  })

  it('caps results and treats acceptance failures as attention', () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw, { now: 1 })
    const deliveryId = addDelivery(database, seeded.workspaceId, '需求', 1)
    markTask(database, seeded.taskId, {
      deliveryId,
      stageKey: 'acceptance',
      status: 'running',
      updatedAt: 20,
    })
    database.db.transaction((tx) => {
      insertAcceptanceContract(tx, {
        id: 'ac1',
        taskId: seeded.taskId,
        version: 1,
        status: 'frozen',
        createdBy: 'verifier',
        revision: 0,
        truncated: false,
        createdAt: 20,
        frozenAt: 20,
      })
      insertAcceptanceItems(tx, [
        {
          id: 'i1',
          contractId: 'ac1',
          ordinal: 1,
          text: '登录成功',
          status: 'fail',
          evidence: null,
          source: 'verifier',
          updatedAt: 20,
        },
      ])
    })

    const result = service(database.db).list(20)
    expect(result.items).toHaveLength(1)
    expect(result.total).toBe(1)
    expect(result.items[0]).toMatchObject({
      taskId: seeded.taskId,
      kind: 'acceptance',
      waitingSince: null,
    })
    expect(service(database.db).list(1).items).toHaveLength(1)
    expect(service(database.db).list(100).items).toHaveLength(1)
  })
})
