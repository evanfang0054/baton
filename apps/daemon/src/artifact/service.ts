import { artifactPath, parsePlaybook } from '@baton/core'
import type { Artifact, ArtifactKind, Playbook } from '@baton/protocol'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import type { Config } from '../config.js'
import {
  getArtifact,
  getCanvasByDelivery,
  getDelivery,
  listArtifactsByDelivery,
  listArtifactsByStage,
  upsertArtifact,
} from '../db/delivery-repositories.js'
import {
  getWorkspace,
  insertAudit,
  insertNode,
  listNodes,
  updateNode,
  deleteNode,
} from '../db/repositories.js'
import type { Db, Tx } from '../db/types.js'
import type { WsEventDraft } from '../db/event-store.js'
import { appError } from '../errors.js'
import { resolveWorkspaceDir, resolveWithin } from '../workspace/resolver.js'

export interface ArtifactServiceDeps {
  db: Db
  config: Config
  now: () => number
  newId: () => string
  emit?: (draft: WsEventDraft) => void
}

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024

function mimeOf(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.md')) return 'text/markdown'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.json') || lower.endsWith('.excalidraw')) return 'application/json'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function parsePlaybookOf(deliveryId: string, db: Db): Playbook | null {
  const delivery = getDelivery(db, deliveryId)
  if (!delivery) return null
  try {
    const parsed = parsePlaybook(JSON.parse(delivery.playbookJson) as unknown)
    return parsed.ok ? parsed.playbook : null
  } catch {
    return null
  }
}

function workspacePathOf(db: Db, config: Config, deliveryId: string): string | null {
  const delivery = getDelivery(db, deliveryId)
  if (!delivery) return null
  const workspace = getWorkspace(db, delivery.workspaceId)
  if (!workspace) return null
  return resolveWorkspaceDir(config.workspacesRoot, workspace.relPath)
}

function safeRootPath(workspacePath: string, relPath: string): string {
  const target = resolveWithin(workspacePath, relPath)
  mkdirSync(dirname(target), { recursive: true })
  const realDir = realpathSync(dirname(target))
  const rel = relative(workspacePath, realDir)
  if (rel.startsWith('..') || rel.startsWith('/')) {
    throw appError('invalid_path', 'artifact path escapes workspace')
  }
  return target
}

export function createArtifactService(deps: ArtifactServiceDeps) {
  /**
   * 产物只存文件 + DB 时，交付画布上没有卡片；这里在登记产物时同步一个
   * artifact 节点，供画布预览与双击打开。drawing 由前端自己建 drawing 节点。
   */
  function syncArtifactNode(tx: Tx, artifact: Artifact): void {
    if (artifact.kind === 'drawing') return
    const canvas = getCanvasByDelivery(deps.db, artifact.deliveryId)
    if (!canvas) return
    const nodes = listNodes(deps.db, canvas.id)
    const group = nodes.find(
      (node) => node.type === 'group' && node.data.stageKey === artifact.stageKey,
    )
    const matches = nodes.filter(
      (node) =>
        node.type === 'artifact' &&
        (node.data.artifactId === artifact.id ||
          (node.data.path === artifact.path && node.groupId === (group?.id ?? null))),
    )
    const [existing, ...duplicates] = matches
    const now = deps.now()
    for (const duplicate of duplicates) {
      deleteNode(tx, duplicate.id)
    }
    if (existing && existing.type === 'artifact') {
      updateNode(tx, existing.id, {
        data: {
          artifactId: artifact.id,
          kind: artifact.kind,
          title: artifact.name,
          path: artifact.path,
          thumbnailPath: artifact.path.endsWith('.png') ? artifact.path : null,
          status: artifact.status,
        },
        updatedAt: now,
      })
      return
    }
    const siblings = nodes.filter(
      (node) => node.type === 'artifact' && node.groupId === (group?.id ?? null),
    )
    const index = siblings.length
    insertNode(tx, {
      id: deps.newId(),
      canvasId: canvas.id,
      type: 'artifact',
      x: (group?.x ?? 120) + 24 + (index % 2) * 220,
      y: (group?.y ?? 420) + 240 + Math.floor(index / 2) * 110,
      w: 200,
      h: 96,
      groupId: group?.id ?? null,
      data: {
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.name,
        path: artifact.path,
        thumbnailPath: artifact.path.endsWith('.png') ? artifact.path : null,
        status: artifact.status,
      },
      createdAt: now,
      updatedAt: now,
    })
  }

  /**
   * 画板节点与 artifact 一一对应；保存时同步缩略图、状态与 stale 标记。
   * 自动保存 source 不调用这里，避免每个 2 秒 chunk 都写节点。
   */
  function syncDrawingNode(tx: Tx, artifact: Artifact, previewStale: boolean): void {
    if (artifact.kind !== 'drawing') return
    const canvas = getCanvasByDelivery(deps.db, artifact.deliveryId)
    if (!canvas) return
    const now = deps.now()
    for (const node of listNodes(deps.db, canvas.id)) {
      if (node.type !== 'drawing' || node.data.artifactId !== artifact.id) continue
      updateNode(tx, node.id, {
        data: {
          ...node.data,
          thumbnailPath: previewStale ? (node.data.thumbnailPath ?? null) : artifact.path,
          status: previewStale ? node.data.status : 'ready',
          previewStale,
        },
        updatedAt: now,
      })
    }
  }

  function listArtifacts(deliveryId: string): Artifact[] {
    return listArtifactsByDelivery(deps.db, deliveryId)
  }

  function emitArtifact(artifact: Artifact): void {
    deps.emit?.({
      type: 'artifact.updated',
      payload: {
        artifactId: artifact.id,
        deliveryId: artifact.deliveryId,
        stageKey: artifact.stageKey,
        status: artifact.status,
      },
      ts: artifact.updatedAt,
    })
  }

  function checkRequiredArtifacts(
    deliveryId: string,
    stageKey: string,
  ): { ok: true; artifacts: Artifact[] } | { ok: false; missing: string[] } {
    const workspacePath = workspacePathOf(deps.db, deps.config, deliveryId)
    if (!workspacePath) return { ok: false, missing: ['workspace_not_found'] }
    const playbook = parsePlaybookOf(deliveryId, deps.db)
    const stage = playbook?.stages.find((item) => item.key === stageKey)
    if (!stage) return { ok: false, missing: [`stage_not_found:${stageKey}`] }
    const missing: string[] = []
    const now = deps.now()
    const written: Artifact[] = []
    deps.db.transaction((tx) => {
      for (const produced of stage.produces) {
        const rel = artifactPath({ deliveryId, stageKey, name: produced.name })
        if (!rel) {
          missing.push(produced.name)
          continue
        }
        const target = resolveWithin(workspacePath, rel)
        if (!existsSync(target) || !statSync(target).isFile() || statSync(target).size === 0) {
          if (produced.required) missing.push(produced.name)
          continue
        }
        const buffer = readFileSync(target)
        if (buffer.length > MAX_ARTIFACT_BYTES) {
          missing.push(`${produced.name}:too_large`)
          continue
        }
        const existing = listArtifactsByStage(deps.db, deliveryId, stageKey).find(
          (item) => item.name === produced.name,
        )
        const artifact: Artifact = {
          id: existing?.id ?? deps.newId(),
          workspaceId: getDelivery(deps.db, deliveryId)!.workspaceId,
          deliveryId,
          stageKey,
          taskId: null,
          kind: produced.kind as ArtifactKind,
          name: produced.name,
          path: rel,
          sourcePath: null,
          svgPath: null,
          mime: mimeOf(produced.name),
          size: buffer.length,
          sha256: sha256(buffer),
          version: 1,
          status: 'ready',
          createdAt: now,
          updatedAt: now,
        }
        upsertArtifact(tx, artifact)
        syncArtifactNode(tx, artifact)
        written.push(artifact)
        insertAudit(tx, {
          id: deps.newId(),
          ts: now,
          actor: 'daemon',
          action: 'artifact.check',
          detail: { deliveryId, stageKey, name: produced.name, size: buffer.length },
        })
      }
    })
    for (const artifact of written) emitArtifact(artifact)
    return missing.length > 0 ? { ok: false, missing } : { ok: true, artifacts: written }
  }

  function createDraftArtifact(input: {
    deliveryId: string
    stageKey: string
    kind: ArtifactKind
    name: string
  }): Artifact {
    const delivery = getDelivery(deps.db, input.deliveryId)
    if (!delivery) throw appError('delivery_not_found', 'delivery not found')
    const rel = artifactPath(input)
    if (!rel) throw appError('invalid_payload', 'invalid artifact name')
    const now = deps.now()
    const artifact: Artifact = {
      id: deps.newId(),
      workspaceId: delivery.workspaceId,
      deliveryId: input.deliveryId,
      stageKey: input.stageKey,
      taskId: null,
      kind: input.kind,
      name: input.name,
      path: rel,
      sourcePath: null,
      svgPath: null,
      mime: mimeOf(input.name),
      size: 0,
      sha256: '0'.repeat(64),
      version: 1,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
    deps.db.transaction((tx) => upsertArtifact(tx, artifact))
    emitArtifact(artifact)
    return artifact
  }

  function saveArtifactContent(input: {
    artifactId: string
    previewBase64?: string
    sourceBase64?: string
    svgBase64?: string
    mode?: 'full' | 'source' | 'preview'
  }): Artifact {
    const artifact = getArtifact(deps.db, input.artifactId)
    if (!artifact) throw appError('artifact_not_found', 'artifact not found')
    const workspacePath = workspacePathOf(deps.db, deps.config, artifact.deliveryId)
    if (!workspacePath) throw appError('workspace_not_found', 'workspace not found')
    const mode = input.mode ?? 'full'
    const preview = input.previewBase64 ? Buffer.from(input.previewBase64, 'base64') : null
    const source = input.sourceBase64 ? Buffer.from(input.sourceBase64, 'base64') : null
    const svg = input.svgBase64 ? Buffer.from(input.svgBase64, 'base64') : null
    if (mode === 'source' && !source) {
      throw appError('invalid_payload', 'source is required for source mode')
    }
    if (mode === 'preview' && !preview) {
      throw appError('invalid_payload', 'preview is required for preview mode')
    }
    for (const [name, buffer] of [
      ['preview', preview],
      ['source', source],
      ['svg', svg],
    ] as const) {
      if (buffer && buffer.length > MAX_ARTIFACT_BYTES) {
        throw appError('payload_too_large', `${name} exceeds 10MB`)
      }
    }
    const writePreview = mode !== 'source' ? preview : null
    const writeSource = mode !== 'preview' ? source : null
    const writeSvg = mode === 'full' ? svg : null
    const updated: Artifact = {
      ...artifact,
      sourcePath:
        writeSource && !artifact.sourcePath
          ? artifact.path.replace(/\.(png|jpg|jpeg|webp)$/i, '.excalidraw')
          : artifact.sourcePath,
      svgPath:
        writeSvg && !artifact.svgPath
          ? artifact.path.replace(/\.(png|jpg|jpeg|webp)$/i, '.svg')
          : artifact.svgPath,
      size: writePreview?.length ?? artifact.size,
      sha256: writePreview ? sha256(writePreview) : artifact.sha256,
      mime: writePreview ? mimeOf(artifact.path) : artifact.mime,
      status: mode === 'source' ? artifact.status : 'ready',
      updatedAt: deps.now(),
    }
    deps.db.transaction((tx) => {
      const write = (rel: string | null, buffer: Buffer | null) => {
        if (!rel || !buffer) return
        writeFileSync(safeRootPath(workspacePath, rel), buffer)
      }
      write(updated.path, writePreview)
      write(updated.sourcePath, writeSource)
      write(updated.svgPath, writeSvg)
      upsertArtifact(tx, updated)
      if (mode !== 'source') {
        if (updated.kind === 'drawing') syncDrawingNode(tx, updated, false)
        else syncArtifactNode(tx, updated)
      }
      if (mode === 'full') {
        insertAudit(tx, {
          id: deps.newId(),
          ts: updated.updatedAt,
          actor: 'human',
          action: 'artifact.save',
          detail: { artifactId: updated.id, size: updated.size },
        })
      }
    })
    if (mode !== 'source') emitArtifact(updated)
    return updated
  }

  function readArtifactContent(
    artifactId: string,
    variant: 'preview' | 'source' | 'svg' = 'preview',
  ): { artifact: Artifact; data: Buffer } {
    const artifact = getArtifact(deps.db, artifactId)
    if (!artifact) throw appError('artifact_not_found', 'artifact not found')
    const workspacePath = workspacePathOf(deps.db, deps.config, artifact.deliveryId)
    if (!workspacePath) throw appError('workspace_not_found', 'workspace not found')
    const rel =
      variant === 'source'
        ? artifact.sourcePath
        : variant === 'svg'
          ? artifact.svgPath
          : artifact.path
    if (!rel) throw appError('artifact_not_found', `artifact ${variant} not found`)
    const target = resolveWithin(workspacePath, rel)
    if (!existsSync(target)) throw appError('artifact_not_found', 'artifact file not found')
    return { artifact, data: readFileSync(target) }
  }

  return {
    listArtifacts,
    listArtifactsByStage: (deliveryId: string, stageKey: string) =>
      listArtifactsByStage(deps.db, deliveryId, stageKey),
    checkRequiredArtifacts,
    createDraftArtifact,
    saveArtifactContent,
    readArtifactContent,
    workspacePathOf: (deliveryId: string) => workspacePathOf(deps.db, deps.config, deliveryId),
  }
}

export type ArtifactService = ReturnType<typeof createArtifactService>
