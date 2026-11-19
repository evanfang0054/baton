import {
  WorkspaceCapabilitiesResponse,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceListResponse,
  WorkspaceTrustInput,
  WorkspaceTrustResponse,
  type Canvas,
  type Workspace,
} from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
import type { Config } from '../config.js'
import {
  getWorkspace,
  getWorkspaceByRelPath,
  insertAudit,
  insertWorkspaceWithCanvas,
  listWorkspaces,
  updateWorkspaceTrust,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'
import { isGitRepo } from '../workspace/worktree.js'

export interface WorkspaceRoutesDeps {
  db: Db
  config: Config
  now: () => number
  newId: () => string
  onTrustChanged?: () => void
}

export function registerWorkspaceRoutes(app: FastifyInstance, deps: WorkspaceRoutesDeps): void {
  app.get('/api/workspaces', async () =>
    WorkspaceListResponse.parse({ workspaces: listWorkspaces(deps.db) }),
  )

  app.post('/api/workspaces', async (req, reply) => {
    const parsed = WorkspaceCreateInput.safeParse(req.body)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid workspace payload', parsed.error.issues)
    }

    const realTarget = resolveWorkspaceDir(deps.config.workspacesRoot, parsed.data.relPath)
    const realRoot = realpathSync(deps.config.workspacesRoot)
    const relPath = relative(realRoot, realTarget).split(sep).join('/')
    if (!relPath || relPath === '.') {
      throw appError('invalid_path', 'workspace must be a subdirectory')
    }
    if (getWorkspaceByRelPath(deps.db, relPath)) {
      throw appError('conflict', 'workspace already exists', { relPath })
    }

    const workspace: Workspace = {
      id: deps.newId(),
      name: parsed.data.name,
      relPath,
      trusted: false,
      projectHooks: 'off',
      trustedAt: null,
      createdAt: deps.now(),
    }
    const canvas: Canvas = {
      id: deps.newId(),
      workspaceId: workspace.id,
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    insertWorkspaceWithCanvas(deps.db, { workspace, canvas })
    return reply.code(201).send(WorkspaceCreateResponse.parse({ workspace, canvas }))
  })

  app.patch('/api/workspaces/:id/trust', async (req) => {
    const parsed = WorkspaceTrustInput.safeParse(req.body)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid trust payload', parsed.error.issues)
    }
    const current = getWorkspace(deps.db, (req.params as { id: string }).id)
    if (!current) {
      throw appError('workspace_not_found', 'workspace not found')
    }
    const projectHooks = parsed.data.projectHooks ?? current.projectHooks
    const trustedAt = parsed.data.trusted ? deps.now() : null

    deps.db.transaction((tx) => {
      updateWorkspaceTrust(tx, current.id, {
        trusted: parsed.data.trusted,
        projectHooks,
        trustedAt,
      })
      insertAudit(tx, {
        id: deps.newId(),
        ts: deps.now(),
        actor: 'user',
        action: parsed.data.trusted ? 'workspace.trust' : 'workspace.untrust',
        detail: { workspaceId: current.id, projectHooks },
      })
      if (projectHooks !== current.projectHooks) {
        insertAudit(tx, {
          id: deps.newId(),
          ts: deps.now(),
          actor: 'user',
          action: 'workspace.project_hooks_changed',
          detail: { workspaceId: current.id, projectHooks },
        })
      }
    })

    deps.onTrustChanged?.()
    return WorkspaceTrustResponse.parse({ workspace: getWorkspace(deps.db, current.id) })
  })

  app.get('/api/workspaces/:id/capabilities', async (req) => {
    const { id } = req.params as { id?: string }
    if (!id) {
      throw appError('invalid_payload', 'workspace id is required')
    }
    const workspace = getWorkspace(deps.db, id)
    if (!workspace) {
      throw appError('workspace_not_found', 'workspace not found', { workspaceId: id })
    }
    const workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
    return WorkspaceCapabilitiesResponse.parse({ worktree: await isGitRepo(workspacePath) })
  })
}
