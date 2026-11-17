import { isSensitivePath } from '@baton/core'
import { readFileSync, realpathSync, statSync } from 'node:fs'
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
 * 目标存在时返回 realpath，保证“校验的路径”与“读取的路径”一致。
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
  let target = abs
  try {
    target = realpathSync(abs)
  } catch {
    // 目标不存在时保留 abs；调用方会在读取时按失败处理。
  }
  if (target !== realRoot && !target.startsWith(`${realRoot}${sep}`)) {
    throw appError('invalid_path', 'path escapes workspace')
  }
  return target
}

export function resolveWorkspaceDir(root: string, relPath: string): string {
  const target = resolveWithin(root, relPath)
  try {
    if (!statSync(target).isDirectory()) {
      throw new Error('not a directory')
    }
  } catch {
    throw appError('invalid_path', 'workspace directory not found')
  }
  return target
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
  if (isSensitivePath(relPath)) {
    return null
  }
  let target: string
  try {
    target = resolveWithin(workspacePath, relPath)
  } catch {
    return null
  }
  if (!TEXT_EXTENSIONS.has(extname(target).toLowerCase())) {
    return null
  }
  try {
    const stat = statSync(target)
    if (!stat.isFile() || stat.size > maxBytes) {
      return null
    }
    return readFileSync(target, 'utf8')
  } catch {
    return null
  }
}
