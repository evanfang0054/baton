import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
  const artifacts = createArtifactService({
    db: handle.database.db,
    config: handle.config,
    now: handle.now,
    newId: handle.newId,
  })
  const deliveries = createDeliveryService({
    db: handle.database.db,
    config: handle.config,
    now: handle.now,
    newId: handle.newId,
    checkArtifacts: artifacts.checkRequiredArtifacts,
  })
  const created = deliveries.createDelivery({
    workspaceId: handle.seeded.workspaceId,
    title: '优惠券领取页',
    goal: '做一个领取页',
  })
  if (!created.ok) throw new Error(created.message)
  return { handle, deliveries, artifacts, deliveryId: created.deliveryId }
}

function writeSpec(handle: ReturnType<typeof createTestRuntime>, deliveryId: string): void {
  const target = join(
    handle.config.workspacesRoot,
    handle.seeded.relPath,
    `.baton/deliveries/${deliveryId}/requirement/spec.md`,
  )
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, '# 需求规格\n')
}

describe('delivery advance', () => {
  it('creates the next stage once and accepts current artifacts', () => {
    const { handle, deliveries, artifacts, deliveryId } = setup()
    writeSpec(handle, deliveryId)
    const draft = artifacts.createDraftArtifact({
      deliveryId,
      stageKey: 'requirement',
      kind: 'spec',
      name: 'spec.md',
    })
    deliveries.syncStageArtifacts(deliveryId, 'requirement')

    const first = deliveries.advanceDelivery(deliveryId, 'requirement')
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    expect(first.nextTaskId).toBeTruthy()

    const detail = deliveries.getDeliveryDetail(deliveryId)
    expect(detail?.stages[1]?.taskId).toBe(first.nextTaskId)
    expect(artifacts.listArtifacts(deliveryId).find((item) => item.id === draft.id)?.status).toBe(
      'accepted',
    )

    const second = deliveries.advanceDelivery(deliveryId, 'requirement')
    expect(second).toEqual(first)
  })

  it('registers a file written by the agent and blocks advance without the required artifact', () => {
    const { handle, deliveries, artifacts, deliveryId } = setup()

    expect(deliveries.advanceDelivery(deliveryId, 'requirement')).toMatchObject({
      ok: false,
      code: 'artifact_missing',
    })

    writeSpec(handle, deliveryId)
    deliveries.syncStageArtifacts(deliveryId, 'requirement')
    expect(artifacts.listArtifacts(deliveryId).map((item) => item.name)).toContain('spec.md')

    const advanced = deliveries.advanceDelivery(deliveryId, 'requirement')
    expect(advanced.ok).toBe(true)
  })
})
