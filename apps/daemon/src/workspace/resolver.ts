import { isSensitivePath } from '@baton/core'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, normalize, resolve, sep } from 'node:path'
import { appError } from '../errors.js'

const MAX_TEXT_BYTES = 256 * 1024

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.css',
  '.scss',
  '.html',
  '.htm',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.vue',
  '.svelte',
  '.graphql',
  '.gql',
  '.xml',
  '.svg',
])

/**
 * 所有文件访问的唯一入口：拒绝绝对路径、`..` 与软链逃逸。
 * 目标存在时用 realpath 校验；目标不存在时只做前缀校验，读取失败由调用方处理。
 */
export function resolveWithin(root: string, relPath: string): string {
  if (!relPath || relPath.trim().length === 0) {
    throw appError('invalid_path', 'path is empty')
  }
  if (isAbsolute(relPath)) {
    throw appError('invalid_path', 'absolute path is not allowed')
  }
  const normalized = normalize(relPath)
  if (normalized === '..' || normalized.startsWith(`..${sep}`)) {
    throw appError('invalid_path', 'path escapes workspace')
  }

  const realRoot = realpathSync(root)
  const abs = resolve(realRoot, normalized)
  const target = existsSync(abs) ? realpathSync(abs) : abs
  if (target !== realRoot && !target.startsWith(`${realRoot}${sep}`)) {
    throw appError('invalid_path', 'path escapes workspace')
  }
  return abs
}

export function resolveWorkspaceDir(root: string, relPath: string): string {
  const abs = resolveWithin(root, relPath)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw appError('invalid_path', 'workspace directory not found')
  }
  return abs
}

/**
 * 只读取工作区内、非敏感、文本类且不超过 256KB 的文件；
 * 其余情况返回 null，由上下文装配只输出文件路径。
 */
export function readWorkspaceText(
  workspacePath: string,
  relPath: string,
  maxBytes = MAX_TEXT_BYTES,
): string | null {
  if (isSensitivePath(relPath)) return null
  let abs: string
  try {
    abs = resolveWithin(workspacePath, relPath)
  } catch {
    return null
  }
  if (!existsSync(abs)) return null
  const stat = statSync(abs)
  if (!stat.isFile() || stat.size > maxBytes) return null
  if (!TEXT_EXTENSIONS.has(extname(abs).toLowerCase())) return null
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}
