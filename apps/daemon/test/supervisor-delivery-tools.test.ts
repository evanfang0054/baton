import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { createAnnotationService } from '../src/annotation/service.js'
import { createDeliveryService } from '../src/delivery/service.js'
import { getCanvasByDelivery, getAnnotation } from '../src/db/delivery-repositories.js'
import { task as taskTable } from '../src/db/schema.js'
import { getTaskDetail, listAudit, listNodes } from '../src/db/repositories.js'
import type { WsEventDraft } from '../src/db/event-store.js'
import { appError } from '../src/errors.js'
import type { Config } from '../src/config.js'
import { createTaskService } from '../src/runtime/task-service.js'
import { createSupervisorTools, type ToolContext } from '../src/supervisor/tools.js'
import { createTestDb, seedTask, seedTextNode, type TestDb } from './helpers/db.js'

const dirs: string[] = []
const dbs: TestDb[] = []

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dbs.splice(0).forEach((entry) => entry.raw.close())
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'baton-delivery-tools-'))
  dirs.push(root)
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw, { withSession: false, trusted: true })
  seedTextNode(database.raw, seeded.canvasId, 'text-1', '把领取页的按钮改成主色')
  const workspaceDir = join(root, seeded.relPath)
  mkdirSync(workspaceDir, { recursive: true })
  const skillDir = join(workspaceDir, '.baton/skills/requirement-grooming')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\ndescription: 澄清需求与验收标准\n---\n# 需求梳理\n',
    'utf8',
  )

  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    token: null,
    dataDir: root,
    webRoot: root,
    workspacesRoot: root,
    maxConcurrency: 1,
    maxLiveSessions: 5,
    claudeMaxTurns: 30,
    claudeProjectHooks: 'on',
    allowBypassPermissions: false,
    killSwitch: false,
  }

  const events: WsEventDraft[] = []
  let seq = 0
  const newId = () => `id-${++seq}`
  const taskService = createTaskService({
    db: database.db,
    config,
    now: () => 10,
    newId: () => `task-${++seq}`,
  })
  const deliveries = createDeliveryService({
    db: database.db,
    config,
    now: () => 10,
    newId,
    emit: (draft) => events.push(draft),
  })
  const annotations = createAnnotationService({
    db: database.db,
    config,
    now: () => 10,
    newId,
    emit: (draft) => events.push(draft),
  })

  const enqueued: string[] = []
  const cancelled: string[] = []
  let automationBlocked: ReturnType<typeof appError> | null = null
  const tools = createSupervisorTools({
    db: database.db,
    workspacesRoot: root,
    taskService,
    now: () => 10,
    newId,
    defaultEngine: 'claude-sdk',
    assertAutomationAllowed: () => automationBlocked,
    enqueueTask: (taskId) => {
      enqueued.push(taskId)
      return { ok: true, status: 'queued' }
    },
    applyTransition: () => ({ ok: false, error: appError('not_used', 'not used') }),
    replyToTask: () => ({ ok: true }),
    injectContext: () => ({ ok: false, error: appError('not_used', 'not used') }),
    cancelTask: (taskId) => {
      cancelled.push(taskId)
      return {
        ok: true,
        taskId,
        status: 'cancelled',
        previousStatus: 'todo',
        retryCount: 0,
        waitingReason: null,
        events: [],
      }
    },
    deliveries: () => deliveries,
    annotations: () => annotations,
  })

  function ctx(): ToolContext {
    return {
      workspaceId: seeded.workspaceId,
      threadId: 'th1',
      triggerId: 'r1',
      text: '做一条交付',
      actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
      selection: { contextNodeIds: ['text-1'], targetNodeId: seeded.nodeId, agentCandidates: [] },
      policyVersion: 'p1',
      promptVersion: 'v1',
      memo: {},
    }
  }

  return {
    database,
    config,
    seeded,
    tools,
    deliveries,
    annotations,
    events,
    enqueued,
    cancelled,
    blockAutomation: (error: ReturnType<typeof appError> | null) => {
      automationBlocked = error
    },
    ctx,
    workspaceDir,
  }
}

function createAnnotation(
  annotations: ReturnType<typeof createAnnotationService>,
  database: TestDb,
  deliveryId: string,
) {
  const canvas = getCanvasByDelivery(database.db, deliveryId)
  if (!canvas) throw new Error('delivery canvas missing')
  const agent = listNodes(database.db, canvas.id).find((node) => node.type === 'agent')
  if (!agent) throw new Error('delivery agent missing')
  return annotations.createAnnotation({
    deliveryId,
    stageKey: 'requirement',
    targetNodeIds: [agent.id],
    note: '按钮换成主色，圆角不变',
    strokesJson: '{"secret-strokes":true}',
    bbox: { x: 1, y: 2, w: 30, h: 40 },
    imageBase64: Buffer.from('fake-png').toString('base64'),
  })
}

describe('supervisor delivery and annotation tools', () => {
  it('creates a delivery with only the first stage and lists it', async () => {
    const { database, tools, ctx, events } = setup()
    const created = (await tools.create_delivery.execute(
      { title: '优惠券领取页', goal: '做一个可用的领取页', contextNodeIds: ['text-1'] },
      ctx(),
    )) as { deliveryId: string; taskId: string; status: string }

    expect(created.status).toBe('draft')
    const detail = (await tools.get_delivery.execute(
      { deliveryId: created.deliveryId },
      ctx(),
    )) as {
      delivery: {
        stages: Array<{ key: string; taskId: string | null; skillStatus: string | null }>
      }
    }
    expect(detail.delivery.stages).toHaveLength(4)
    expect(detail.delivery.stages[0]?.taskId).toBe(created.taskId)
    expect(detail.delivery.stages[1]?.taskId).toBeNull()
    expect(detail.delivery.stages[0]?.skillStatus).toBe('ok')

    const listed = (await tools.list_deliveries.execute({}, ctx())) as {
      deliveries: Array<{ id: string; status: string }>
    }
    expect(listed.deliveries).toEqual([
      expect.objectContaining({ id: created.deliveryId, status: 'draft' }),
    ])
    expect(events.some((event) => event.type === 'delivery.updated')).toBe(true)

    const task = getTaskDetail(database.db, created.taskId)
    expect(task?.task.deliveryId).toBe(created.deliveryId)
    expect(task?.task.stageKey).toBe('requirement')
    expect(task?.task.prompt).toContain('<skill')
    expect(task?.task.prompt).toContain('.baton/skills/requirement-grooming/SKILL.md')
  })

  it('enqueues only a todo current stage and never approves gates', async () => {
    const { database, tools, ctx, enqueued } = setup()
    const created = (await tools.create_delivery.execute(
      { title: '交付 A', goal: '目标 A' },
      ctx(),
    )) as { deliveryId: string; taskId: string }

    const started = (await tools.enqueue_delivery.execute(
      { deliveryId: created.deliveryId },
      ctx(),
    )) as { taskId: string; status: string }
    expect(started).toEqual({
      deliveryId: created.deliveryId,
      taskId: created.taskId,
      status: 'queued',
    })
    expect(enqueued).toEqual([created.taskId])

    database.db
      .update(taskTable)
      .set({ status: 'queued' })
      .where(eq(taskTable.id, created.taskId))
      .run()
    await expect(
      tools.enqueue_delivery.execute({ deliveryId: created.deliveryId }, ctx()),
    ).rejects.toMatchObject({ code: 'not_todo' })
    expect(Object.keys(tools)).not.toContain('approve')
    expect(Object.keys(tools)).not.toContain('reject')
    expect(Object.keys(tools)).not.toContain('resolve_annotation')
  })

  it('blocks enqueue_delivery when automation is paused', async () => {
    const { tools, ctx, enqueued, blockAutomation } = setup()
    const created = (await tools.create_delivery.execute(
      { title: '交付 E', goal: '目标 E' },
      ctx(),
    )) as { deliveryId: string; taskId: string }
    blockAutomation(appError('automation_paused', 'automation paused'))

    await expect(
      tools.enqueue_delivery.execute({ deliveryId: created.deliveryId }, ctx()),
    ).rejects.toMatchObject({ code: 'automation_paused' })
    expect(enqueued).toEqual([])
  })

  it('rejects delivery tools from another workspace', async () => {
    const { tools, ctx } = setup()
    const created = (await tools.create_delivery.execute(
      { title: '交付 F', goal: '目标 F' },
      ctx(),
    )) as { deliveryId: string }
    const other = { ...ctx(), workspaceId: 'other-workspace' }

    await expect(
      tools.get_delivery.execute({ deliveryId: created.deliveryId }, other),
    ).rejects.toMatchObject({ code: 'delivery_not_found' })
    await expect(
      tools.cancel_delivery.execute({ deliveryId: created.deliveryId, confirm: true }, other),
    ).rejects.toMatchObject({ code: 'delivery_not_found' })
  })

  it('requires confirmation before cancelling a delivery and is idempotent', async () => {
    const { database, tools, ctx, deliveries, cancelled } = setup()
    const created = (await tools.create_delivery.execute(
      { title: '交付 D', goal: '目标 D' },
      ctx(),
    )) as { deliveryId: string; taskId: string }

    const first = (await tools.cancel_delivery.execute(
      { deliveryId: created.deliveryId },
      ctx(),
    )) as { confirmationRequired: boolean; code?: string; status: string }
    expect(first).toMatchObject({
      confirmationRequired: true,
      code: 'confirmation_required',
      status: 'draft',
    })
    expect(deliveries.getDeliveryDetail(created.deliveryId)?.status).toBe('draft')
    expect(cancelled).toEqual([])

    const confirmed = (await tools.cancel_delivery.execute(
      { deliveryId: created.deliveryId, confirm: true },
      ctx(),
    )) as { status: string; taskId: string | null }
    expect(confirmed).toMatchObject({ status: 'cancelled', taskId: created.taskId })
    expect(deliveries.getDeliveryDetail(created.deliveryId)?.status).toBe('cancelled')
    expect(cancelled).toEqual([created.taskId])

    const again = (await tools.cancel_delivery.execute(
      { deliveryId: created.deliveryId, confirm: true },
      ctx(),
    )) as { alreadyCancelled: boolean }
    expect(again.alreadyCancelled).toBe(true)
    expect(cancelled).toEqual([created.taskId])

    expect(
      listAudit(database.db, { actionPrefix: 'supervisor.delivery.cancel', limit: 10 })[0]?.detail,
    ).toMatchObject({
      deliveryId: created.deliveryId,
      taskId: created.taskId,
      confirmedByUser: true,
    })
  })

  it('exposes annotation summaries without strokes and injects them into prompts', async () => {
    const { database, seeded, tools, annotations, ctx } = setup()
    const created = (await tools.create_delivery.execute(
      { title: '交付 B', goal: '目标 B' },
      ctx(),
    )) as { deliveryId: string }
    const annotation = createAnnotation(annotations, database, created.deliveryId)

    const listed = (await tools.list_annotations.execute(
      { deliveryId: created.deliveryId },
      ctx(),
    )) as { annotations: Array<Record<string, unknown>> }
    expect(listed.annotations[0]).toMatchObject({
      id: annotation.id,
      note: '按钮换成主色，圆角不变',
      bbox: { x: 1, y: 2, w: 30, h: 40 },
    })
    expect(listed.annotations[0]).not.toHaveProperty('strokesJson')

    const fetched = (await tools.get_annotation.execute(
      { annotationId: annotation.id },
      ctx(),
    )) as { annotation: Record<string, unknown> }
    expect(fetched.annotation.imagePath).toContain('.baton/deliveries/')
    expect(fetched.annotation).not.toHaveProperty('strokesJson')

    const task = (await tools.create_task.execute(
      {
        title: '按标注改按钮',
        prompt: '按标注调整按钮颜色',
        targetNodeId: seeded.nodeId,
        annotationIds: [annotation.id],
      },
      ctx(),
    )) as { taskId: string }
    const detail = getTaskDetail(database.db, task.taskId)
    expect(detail?.task.annotationIds).toEqual([annotation.id])
    expect(detail?.task.prompt).toContain('<annotations>')
    expect(detail?.task.prompt).toContain('按钮换成主色，圆角不变')
    expect(detail?.task.prompt).toContain('bbox="1,2,30,40"')
    expect(detail?.task.prompt).not.toContain('secret-strokes')
    expect(getAnnotation(database.db, annotation.id)?.taskId).toBe(task.taskId)
  })

  it('rejects annotations from another workspace', async () => {
    const { database, tools, annotations, ctx } = setup()
    const created = (await tools.create_delivery.execute(
      { title: '交付 C', goal: '目标 C' },
      ctx(),
    )) as { deliveryId: string }
    const annotation = createAnnotation(annotations, database, created.deliveryId)

    const other = setup()
    await expect(
      other.tools.create_task.execute(
        {
          title: '错误标注',
          prompt: '用别的 workspace 的标注',
          targetNodeId: other.seeded.nodeId,
          annotationIds: [annotation.id],
        },
        other.ctx(),
      ),
    ).rejects.toMatchObject({
      code: 'supervisor_task_create_failed',
      details: { code: 'annotation_not_found' },
    })
  })
  it('rejects task recovery and cross-workspace annotations after delivery cancel', async () => {
    const { database, tools, ctx, annotations } = setup()
    const created = (await tools.create_delivery.execute(
      { title: '交付 G', goal: '目标 G' },
      ctx(),
    )) as { deliveryId: string; taskId: string }
    const annotation = createAnnotation(annotations, database, created.deliveryId)

    await tools.cancel_delivery.execute({ deliveryId: created.deliveryId, confirm: true }, ctx())

    await expect(
      tools.reopen_task.execute({ taskId: created.taskId }, ctx()),
    ).rejects.toMatchObject({ code: 'delivery_cancelled' })

    database.db
      .update(taskTable)
      .set({ status: 'failed' })
      .where(eq(taskTable.id, created.taskId))
      .run()
    await expect(
      tools.retry_task.execute({ taskId: created.taskId, note: '再试一次' }, ctx()),
    ).rejects.toMatchObject({ code: 'delivery_cancelled' })

    const other = { ...ctx(), workspaceId: 'other-workspace' }
    await expect(
      tools.list_annotations.execute({ deliveryId: created.deliveryId }, other),
    ).rejects.toMatchObject({ code: 'delivery_not_found' })
    await expect(
      tools.get_annotation.execute({ annotationId: annotation.id }, other),
    ).rejects.toMatchObject({ code: 'delivery_not_found' })
  })
})
