import { artifactPath, parsePlaybook } from '@baton/core'
import type { Artifact, ArtifactKind, Playbook } from '@baton/protocol'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import type { Config } from '../config.js'
import {
  getArtifact,
  getDelivery,
  listArtifactsByDelivery,
  listArtifactsByStage,
  upsertArtifact,
} from '../db/delivery-repositories.js'
import { getWorkspace, insertAudit } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import { resolveWorkspaceDir, resolveWithin } from '../workspace/resolver.js'

export interface ArtifactServiceDeps {
  db: Db
  config: Config
  now: () => number
  newId: () => string
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
  function listArtifacts(deliveryId: string): Artifact[] {
    return listArtifactsByDelivery(deps.db, deliveryId)
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
        const artifact: Artifact = {
          id: deps.newId(),
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
      sha256: '',
      version: 1,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
    deps.db.transaction((tx) => upsertArtifact(tx, artifact))
    return artifact
  }

  function saveArtifactContent(input: {
    artifactId: string
    previewBase64?: string
    sourceBase64?: string
    svgBase64?: string
  }): Artifact {
    const artifact = getArtifact(deps.db, input.artifactId)
    if (!artifact) throw appError('artifact_not_found', 'artifact not found')
    const workspacePath = workspacePathOf(deps.db, deps.config, artifact.deliveryId)
    if (!workspacePath) throw appError('workspace_not_found', 'workspace not found')
    const preview = input.previewBase64 ? Buffer.from(input.previewBase64, 'base64') : null
    const source = input.sourceBase64 ? Buffer.from(input.sourceBase64, 'base64') : null
    const svg = input.svgBase64 ? Buffer.from(input.svgBase64, 'base64') : null
    for (const [name, buffer] of [
      ['preview', preview],
      ['source', source],
      ['svg', svg],
    ] as const) {
      if (buffer && buffer.length > MAX_ARTIFACT_BYTES) {
        throw appError('payload_too_large', `${name} exceeds 10MB`)
      }
    }
    const updated: Artifact = {
      ...artifact,
      sourcePath:
        source && !artifact.sourcePath
          ? artifact.path.replace(/\.(png|jpg|jpeg|webp)$/i, '.excalidraw')
          : artifact.sourcePath,
      svgPath:
        svg && !artifact.svgPath
          ? artifact.path.replace(/\.(png|jpg|jpeg|webp)$/i, '.svg')
          : artifact.svgPath,
      size: preview?.length ?? artifact.size,
      sha256: preview ? sha256(preview) : artifact.sha256,
      mime: preview ? mimeOf(artifact.path) : artifact.mime,
      status: 'ready',
      updatedAt: deps.now(),
    }
    deps.db.transaction((tx) => {
      const write = (rel: string | null, buffer: Buffer | null) => {
        if (!rel || !buffer) return
        writeFileSync(safeRootPath(workspacePath, rel), buffer)
      }
      write(updated.path, preview)
      write(updated.sourcePath, source)
      write(updated.svgPath, svg)
      upsertArtifact(tx, updated)
      insertAudit(tx, {
        id: deps.newId(),
        ts: updated.updatedAt,
        actor: 'human',
        action: 'artifact.save',
        detail: { artifactId: updated.id, size: updated.size },
      })
    })
    return updated
  }

  function readArtifactContent(artifactId: string): { artifact: Artifact; data: Buffer } {
    const artifact = getArtifact(deps.db, artifactId)
    if (!artifact) throw appError('artifact_not_found', 'artifact not found')
    const workspacePath = workspacePathOf(deps.db, deps.config, artifact.deliveryId)
    if (!workspacePath) throw appError('workspace_not_found', 'workspace not found')
    const target = resolveWithin(workspacePath, artifact.path)
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
