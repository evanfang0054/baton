import { WorkspaceUploadInput, WorkspaceUploadResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import {
  createReadStream,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, extname, join, sep } from 'node:path'
import type { Config } from '../config.js'
import { getWorkspace } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import { resolveWorkspaceDir, resolveWithin } from '../workspace/resolver.js'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const UPLOAD_DIR = '.baton/uploads'

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

function safeFileName(value: string): string {
  const name = [...basename(value.replaceAll('\\', '/'))]
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    .trim()
    .slice(-120)
  return name.length > 0 ? name : 'file'
}

/** mkdir 会跟随软链；先拒绝 .baton / uploads 本身是软链，避免在工作区外建目录。 */
function rejectSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw appError('upload_failed', 'upload directory must not be a symlink')
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}

export interface UploadRoutesDeps {
  db: Db
  config: Config
  newId: () => string
}

/**
 * 上传是显式的用户动作：只写 workspace 内的 .baton/uploads/，不覆盖任何已有文件。
 * 文件名由服务端生成前缀，原始名字只保留为可读后缀，避免路径穿越与同名覆盖。
 */
export function registerUploadRoutes(app: FastifyInstance, deps: UploadRoutesDeps): void {
  app.post('/api/workspaces/:id/uploads', { bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
    const parsed = WorkspaceUploadInput.safeParse(req.body)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid upload payload', parsed.error.issues)
    }
    const workspace = getWorkspace(deps.db, (req.params as { id: string }).id)
    if (!workspace) {
      throw appError('workspace_not_found', 'workspace not found')
    }
    const workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
    const name = safeFileName(parsed.data.name)
    const content = Buffer.from(parsed.data.dataBase64, 'base64')
    if (content.byteLength === 0) {
      throw appError('invalid_payload', 'uploaded file is empty')
    }
    if (content.byteLength > MAX_UPLOAD_BYTES) {
      throw appError('upload_too_large', 'uploaded file exceeds 10MB', {
        size: content.byteLength,
      })
    }

    const uploadDir = resolveWithin(workspacePath, UPLOAD_DIR)
    const fileName = `${Date.now().toString(36)}-${deps.newId().slice(0, 8)}-${name}`
    try {
      rejectSymlink(join(workspacePath, '.baton'))
      rejectSymlink(uploadDir)
      mkdirSync(uploadDir, { recursive: true, mode: 0o700 })
      // mkdir 后再 realpath 一次，确保 .baton 不是指向工作区外的软链。
      const realDir = resolveWithin(workspacePath, UPLOAD_DIR)
      writeFileSync(join(realDir, fileName), content, { mode: 0o600 })
    } catch {
      throw appError('upload_failed', 'cannot write uploaded file')
    }

    return reply.code(201).send(
      WorkspaceUploadResponse.parse({
        file: {
          name,
          path: `${UPLOAD_DIR}/${fileName}`,
          mime: parsed.data.mime ?? null,
          size: content.byteLength,
        },
      }),
    )
  })

  /**
   * 只服务 .baton/uploads 下的图片；不做通用文件读取、不列目录、不代理外链。
   * realpath + sep 前缀校验，阻断软链与 .. 逃逸。
   */
  app.get('/api/workspaces/:id/uploads/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string }
    const workspace = getWorkspace(deps.db, id)
    if (!workspace) throw appError('workspace_not_found', 'workspace not found')
    if (name !== basename(name) || name.includes('\\') || name.includes('/')) {
      throw appError('image_not_found', 'image not found')
    }

    const workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
    const uploadDir = resolveWithin(workspacePath, UPLOAD_DIR)
    let realFile: string
    try {
      const realDir = realpathSync(uploadDir)
      const candidate = resolveWithin(uploadDir, name)
      if (lstatSync(candidate).isSymbolicLink()) throw new Error('symlink')
      realFile = realpathSync(candidate)
      if (!realFile.startsWith(`${realDir}${sep}`)) throw new Error('escape')
    } catch {
      throw appError('image_not_found', 'image not found')
    }

    const mime = IMAGE_MIME[extname(realFile).toLowerCase()]
    if (!mime) throw appError('image_type_unsupported', 'unsupported image type')
    const stat = statSync(realFile)
    if (stat.size > MAX_UPLOAD_BYTES) throw appError('image_too_large', 'image too large')

    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Cache-Control', 'private, max-age=300')
    if (mime === 'image/svg+xml') {
      reply.header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      )
    }
    return reply.type(mime).send(createReadStream(realFile))
  })
}
