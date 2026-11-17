import {
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceListResponse,
  type Canvas,
  type Workspace,
} from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
import type { Config } from '../config.js'
import {
  getWorkspaceByRelPath,
  insertWorkspaceWithCanvas,
  listWorkspaces,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'

export interface WorkspaceRoutesDeps {
  db: Db
  config: Config
  now: () => number
  newId: () => string
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
}
