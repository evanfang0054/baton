import {
  assembleContext,
  artifactPath,
  buildStagePrompt,
  deriveCurrentStageKey,
  deriveDeliveryStatus,
  deriveStageStatus,
  parsePlaybook,
  type StagePromptArtifact,
} from '@baton/core'
import type {
  Annotation,
  AnnotationSummary,
  Attention,
  Delivery,
  DeliveryDetail,
  DeliverySummary,
  Engine,
  Playbook,
  StageSummary,
  Task,
} from '@baton/protocol'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '../config.js'
import {
  getCanvasByWorkspace,
  getWorkspace,
  insertAudit,
  insertNode,
  insertTask,
  listEdges,
  listNodes,
  listTasks,
} from '../db/repositories.js'
import {
  getDelivery,
  insertDelivery,
  listAnnotations,
  listArtifactsByDelivery,
  listArtifactsByStage,
  listDeliveries as listDeliveryRows,
  setCanvasDelivery,
  setDeliveryCancelled,
} from '../db/delivery-repositories.js'
import { canvas as canvasTable } from '../db/schema.js'
import type { Db, Tx } from '../db/types.js'
import { appError } from '../errors.js'
import { buildContextContent } from '../workspace/context.js'
import { resolveWorkspaceDir, resolveWithin } from '../workspace/resolver.js'
import { loadPlaybook } from './playbook.js'

export interface DeliveryServiceDeps {
  db: Db
  config: Config
  now: () => number
  newId: () => string
}

export interface CreateDeliveryInput {
  workspaceId: string
  title: string
  goal: string
  playbookId?: string
  contextNodeIds?: string[]
  engine?: Engine
  budgetUsd?: number
}

export type CreateDeliveryResult =
  { ok: true; deliveryId: string; taskId: string } | { ok: false; code: string; message: string }

export type DeliveryActionResult =
  { ok: true; taskId: string } | { ok: false; code: string; message: string }

function skillRef(workspacePath: string, trusted: boolean, skillId: string | null) {
  if (!skillId) return null
  if (!trusted) return null
  const rel = join('.baton', 'skills', skillId, 'SKILL.md')
  const path = resolveWithin(workspacePath, rel)
  if (!existsSync(path)) return null
  const head = readFileSync(path, 'utf8').slice(0, 4096)
  const summary =
    head
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('description:'))
      ?.replace(/^description:\s*/, '')
      .trim() ?? skillId
  return { id: skillId, path: rel, summary }
}

function stageArtifacts(
  deliveryId: string,
  stageKey: string,
  produces: Playbook['stages'][number]['produces'],
): StagePromptArtifact[] {
  return produces.flatMap((item) => {
    const path = artifactPath({ deliveryId, stageKey, name: item.name })
    return path ? [{ kind: item.kind, name: item.name, path, required: item.required }] : []
  })
}

function createStageTask(input: {
  deps: DeliveryServiceDeps
  tx: Tx
  delivery: Delivery
  playbook: Playbook
  stage: Playbook['stages'][number]
  ordinal: number
  workspacePath: string
  trusted: boolean
  contextNodeIds: string[]
  engine: Engine
  budgetUsd: number | null
  groupId: string
  previousStageKey: string | null
}): { taskId: string; agentNodeId: string } {
  const { deps, tx, delivery, stage, ordinal } = input
  const now = deps.now()
  const taskId = deps.newId()
  const agentNodeId = deps.newId()
  const agentX = 80 + (ordinal - 1) * 540 + 40
  const agentY = 160 + 80
  insertNode(tx, {
    id: agentNodeId,
    canvasId: delivery.canvasId,
    type: 'agent',
    x: agentX,
    y: agentY,
    w: 320,
    h: 200,
    groupId: input.groupId,
    createdAt: now,
    updatedAt: now,
    data: { title: `${stage.label} Agent`, engine: input.engine, taskId },
  })

  const stagePrompt = buildStagePrompt({
    delivery: { id: delivery.id, title: delivery.title, goal: delivery.goal },
    stage: { key: stage.key, label: stage.label, gate: stage.gate, ordinal },
    produces: stageArtifacts(delivery.id, stage.key, stage.produces),
    acceptance: stage.acceptance,
    previous: input.previousStageKey
      ? [
          {
            stageKey: input.previousStageKey,
            artifacts: listArtifactsByStage(deps.db, delivery.id, input.previousStageKey).map(
              (artifact) => ({
                kind: artifact.kind,
                name: artifact.name,
                path: artifact.path,
                required: false,
              }),
            ),
          },
        ]
      : [],
    skill: skillRef(input.workspacePath, input.trusted, stage.skill),
    annotations: [],
  })

  const workspaceCanvas = getCanvasByWorkspace(deps.db, delivery.workspaceId)
  const nodes = workspaceCanvas ? listNodes(deps.db, workspaceCanvas.id) : []
  const edges = workspaceCanvas ? listEdges(deps.db, workspaceCanvas.id) : []
  const contentByNodeId = workspaceCanvas
    ? buildContextContent({ nodes, workspacePath: input.workspacePath }).contentByNodeId
    : {}
  const assembled = assembleContext({
    taskPrompt: stagePrompt,
    targetNodeId: agentNodeId,
    selectedNodeIds: input.contextNodeIds,
    nodes,
    edges,
    contentByNodeId,
  })

  insertTask(tx, {
    id: taskId,
    workspaceId: delivery.workspaceId,
    nodeId: agentNodeId,
    title: `${stage.label}：${delivery.title}`,
    prompt: assembled.prompt,
    status: 'todo',
    waitingReason: null,
    engine: input.engine,
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    retryCount: 0,
    dangerouslySkipPermissions: false,
    budgetUsd: input.budgetUsd,
    deliveryId: delivery.id,
    stageKey: stage.key,
    annotationIds: [],
    createdAt: now,
    updatedAt: now,
  })
  return { taskId, agentNodeId }
}

function attentionOf(task: Task | undefined): Attention {
  if (!task) return 'none'
  if (task.status === 'waiting_input') return 'needs_reply'
  if (task.status === 'review') return 'needs_review'
  if (task.status === 'failed') return 'needs_attention'
  return 'none'
}

function buildSummaries(
  deps: DeliveryServiceDeps,
  delivery: Delivery,
): { stages: StageSummary[]; summary: DeliverySummary } {
  const playbook = parsePlaybook(JSON.parse(delivery.playbookJson) as unknown)
  const stagesPlaybook = playbook.ok ? playbook.playbook.stages : []
  const tasks = listTasks(deps.db, { workspaceId: delivery.workspaceId }).filter(
    (task) => task.deliveryId === delivery.id,
  )
  const artifacts = listArtifactsByDelivery(deps.db, delivery.id)
  const annotations = listAnnotations(deps.db, { deliveryId: delivery.id })
  const stages: StageSummary[] = stagesPlaybook.map((stage, index) => {
    const task = tasks.find((item) => item.stageKey === stage.key)
    const stageArtifactsList = artifacts.filter((item) => item.stageKey === stage.key)
    const stageAnnotations = annotations.filter(
      (item) => item.stageKey === stage.key && item.status === 'open',
    )
    return {
      key: stage.key,
      label: stage.label,
      ordinal: index + 1,
      gate: stage.gate,
      status: deriveStageStatus(task?.status ?? null),
      taskId: task?.id ?? null,
      taskStatus: task?.status ?? null,
      attention: attentionOf(task),
      waitingSince:
        task && (task.status === 'review' || task.status === 'waiting_input')
          ? task.updatedAt
          : null,
      artifactCount: stageArtifactsList.length,
      openAnnotationCount: stageAnnotations.length,
      skillId: stage.skill,
      skillStatus: null,
    }
  })
  const status = deriveDeliveryStatus({
    cancelled: delivery.cancelledAt !== null,
    stages: stages.map((stage) => ({ key: stage.key, status: stage.status })),
  })
  const waiting = stages
    .map((stage) => stage.waitingSince)
    .filter((value): value is number => value !== null)
  const attention =
    stages.find((stage) => stage.attention !== 'none')?.attention ??
    (status === 'blocked' ? 'needs_attention' : 'none')
  return {
    stages,
    summary: {
      id: delivery.id,
      workspaceId: delivery.workspaceId,
      canvasId: delivery.canvasId,
      title: delivery.title,
      goal: delivery.goal,
      playbookId: delivery.playbookId,
      playbookVersion: delivery.playbookVersion,
      status,
      currentStageKey: deriveCurrentStageKey(stages),
      stageProgress: {
        done: stages.filter((stage) => stage.status === 'done').length,
        total: stages.length,
      },
      attention,
      waitingSince: waiting.length > 0 ? Math.min(...waiting) : null,
      openAnnotationCount: annotations.filter((item) => item.status === 'open').length,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      cancelledAt: delivery.cancelledAt,
    },
  }
}

function annotationSummary(annotation: Annotation): AnnotationSummary {
  return {
    id: annotation.id,
    deliveryId: annotation.deliveryId,
    stageKey: annotation.stageKey,
    targetNodeIds: annotation.targetNodeIds,
    targetArtifactId: annotation.targetArtifactId,
    note: annotation.note,
    bbox: annotation.bbox,
    imagePath: annotation.imagePath,
    status: annotation.status,
    taskId: annotation.taskId,
    createdAt: annotation.createdAt,
  }
}

export function createDeliveryService(deps: DeliveryServiceDeps) {
  function createDelivery(input: CreateDeliveryInput): CreateDeliveryResult {
    const workspace = getWorkspace(deps.db, input.workspaceId)
    if (!workspace) {
      return { ok: false, code: 'workspace_not_found', message: 'workspace not found' }
    }
    const workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
    const loaded = loadPlaybook(workspacePath, input.playbookId ?? 'standard-delivery')
    if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message }
    const playbook = loaded.playbook
    const deliveryId = deps.newId()
    const canvasId = deps.newId()
    const now = deps.now()
    const contextNodeIds = input.contextNodeIds ?? []
    const engine: Engine = input.engine ?? 'claude-sdk'
    try {
      const result = deps.db.transaction((tx) => {
        tx.insert(canvasTable)
          .values({ id: canvasId, workspaceId: workspace.id, viewportJson: '{}' })
          .run()
        const delivery: Delivery = {
          id: deliveryId,
          workspaceId: workspace.id,
          canvasId,
          title: input.title,
          goal: input.goal,
          playbookId: playbook.id,
          playbookVersion: playbook.version,
          playbookJson: JSON.stringify(playbook),
          createdAt: now,
          updatedAt: now,
          cancelledAt: null,
        }
        insertDelivery(tx, delivery)
        setCanvasDelivery(tx, canvasId, deliveryId)
        const groupIds = playbook.stages.map((stage, index) => {
          const groupId = deps.newId()
          insertNode(tx, {
            id: groupId,
            canvasId,
            type: 'group',
            x: 80 + index * 540,
            y: 160,
            w: 480,
            h: 360,
            groupId: null,
            createdAt: now,
            updatedAt: now,
            data: {
              label: `${index + 1} ${stage.label}`,
              collapsed: false,
              stageKey: stage.key,
            },
          })
          return groupId
        })
        const first = playbook.stages[0]
        if (!first) throw appError('playbook_invalid', 'playbook has no stages')
        const task = createStageTask({
          deps,
          tx,
          delivery,
          playbook,
          stage: first,
          ordinal: 1,
          workspacePath,
          trusted: workspace.trusted,
          contextNodeIds,
          engine,
          budgetUsd: input.budgetUsd ?? null,
          groupId: groupIds[0] ?? '',
          previousStageKey: null,
        })
        insertAudit(tx, {
          id: deps.newId(),
          ts: now,
          actor: 'human',
          action: 'delivery.create',
          detail: { deliveryId, taskId: task.taskId, playbookId: playbook.id },
        })
        return task
      })
      return { ok: true, deliveryId, taskId: result.taskId }
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof Error && 'code' in error ? String(error.code) : 'delivery_create_failed',
        message: error instanceof Error ? error.message : 'failed to create delivery',
      }
    }
  }

  function listDeliveries(workspaceId: string): DeliverySummary[] {
    return listDeliveryRows(deps.db, workspaceId).map(
      (delivery) => buildSummaries(deps, delivery).summary,
    )
  }

  function getDeliveryDetail(id: string): DeliveryDetail | null {
    const delivery = getDelivery(deps.db, id)
    if (!delivery) return null
    const { stages, summary } = buildSummaries(deps, delivery)
    const playbook = parsePlaybook(JSON.parse(delivery.playbookJson) as unknown)
    return {
      ...summary,
      playbook: playbook.ok
        ? playbook.playbook
        : { id: 'invalid', version: 1, label: 'invalid', stages: [] },
      stages,
      artifacts: listArtifactsByDelivery(deps.db, id),
      annotations: listAnnotations(deps.db, { deliveryId: id }).map(annotationSummary),
    }
  }

  function enqueueDelivery(id: string): DeliveryActionResult {
    const delivery = getDelivery(deps.db, id)
    if (!delivery) return { ok: false, code: 'delivery_not_found', message: 'delivery not found' }
    const { stages } = buildSummaries(deps, delivery)
    const current = stages.find((stage) => stage.status !== 'done' && stage.status !== 'cancelled')
    if (!current?.taskId) {
      return { ok: false, code: 'no_stage', message: 'no enqueueable stage' }
    }
    const task = listTasks(deps.db, { workspaceId: delivery.workspaceId }).find(
      (item) => item.id === current.taskId,
    )
    if (task?.status !== 'todo') {
      return { ok: false, code: 'not_todo', message: 'current stage is not todo' }
    }
    return { ok: true, taskId: current.taskId }
  }

  function cancelDelivery(id: string): DeliveryActionResult {
    const delivery = getDelivery(deps.db, id)
    if (!delivery) return { ok: false, code: 'delivery_not_found', message: 'delivery not found' }
    if (delivery.cancelledAt !== null) {
      return { ok: false, code: 'cancelled', message: 'delivery is already cancelled' }
    }
    const { stages } = buildSummaries(deps, delivery)
    const current = stages.find(
      (stage) => stage.taskId && stage.status !== 'done' && stage.status !== 'cancelled',
    )
    const now = deps.now()
    deps.db.transaction((tx) => {
      setDeliveryCancelled(tx, id, now)
      insertAudit(tx, {
        id: deps.newId(),
        ts: now,
        actor: 'human',
        action: 'delivery.cancel',
        detail: { deliveryId: id, taskId: current?.taskId ?? null },
      })
    })
    return current?.taskId
      ? { ok: true, taskId: current.taskId }
      : { ok: false, code: 'no_stage', message: 'no cancellable stage' }
  }

  return { createDelivery, listDeliveries, getDeliveryDetail, enqueueDelivery, cancelDelivery }
}

export type DeliveryService = ReturnType<typeof createDeliveryService>
