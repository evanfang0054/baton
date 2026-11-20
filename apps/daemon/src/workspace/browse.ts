import type { WorkspaceBrowseEntry, WorkspaceBrowseResponse } from '@baton/protocol'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appError } from '../errors.js'
import { resolveWorkspaceDir, toWorkspaceRelPath } from './resolver.js'

const MAX_ENTRIES = 300
const MAX_SEARCH_RESULTS = 50
const MAX_SEARCH_DEPTH = 4
// 搜索是同步 IO；给访问目录数设上限，避免在 home 根下阻塞 daemon 事件循环。
const MAX_SEARCH_VISITS = 3000
// 搜索时跳过这些目录，避免在 home 根下一头扎进依赖或构建产物。
const SKIPPED_SEARCH_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'target',
  'vendor',
  '.next',
  '.cache',
  '.turbo',
  'Library',
  'Applications',
  '.Trash',
])

function joinRel(base: string, name: string): string {
  return base ? `${base}/${name}` : name
}

function entryFor(current: string, relPath: string, name: string): WorkspaceBrowseEntry {
  return {
    name,
    relPath: joinRel(relPath, name),
    hasGit: existsSync(join(current, name, '.git')),
  }
}

function readVisibleDirents(current: string): Array<{ name: string }> {
  return readdirSync(current, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory() && !dirent.isSymbolicLink())
    .filter((dirent) => !dirent.name.startsWith('.'))
    .map((dirent) => ({ name: dirent.name }))
}

function visibleDirents(current: string): Array<{ name: string }> {
  try {
    return readVisibleDirents(current)
  } catch {
    throw appError('invalid_path', 'directory is not readable')
  }
}

function listDirectories(current: string, relPath: string) {
  const entries: WorkspaceBrowseEntry[] = []
  let truncated = false
  for (const dirent of visibleDirents(current)) {
    if (entries.length >= MAX_ENTRIES) {
      truncated = true
      break
    }
    entries.push(entryFor(current, relPath, dirent.name))
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return { entries, truncated }
}

interface SearchBudget {
  visits: number
  truncated: boolean
  stop: boolean
}

function hasVisibleChildren(path: string, budget: SearchBudget): boolean {
  if (budget.visits >= MAX_SEARCH_VISITS) {
    budget.truncated = true
    budget.stop = true
    return false
  }
  budget.visits += 1
  try {
    return readVisibleDirents(path).length > 0
  } catch {
    // 读不到就按“可能有更深内容”处理，避免静默漏报。
    return true
  }
}

function searchDirectories(
  current: string,
  relPath: string,
  query: string,
  depth: number,
  results: WorkspaceBrowseEntry[],
  budget: SearchBudget,
): void {
  if (budget.stop) return
  if (results.length >= MAX_SEARCH_RESULTS) {
    budget.truncated = true
    budget.stop = true
    return
  }
  if (budget.visits >= MAX_SEARCH_VISITS) {
    budget.truncated = true
    budget.stop = true
    return
  }
  budget.visits += 1

  let dirents: Array<{ name: string }>
  try {
    dirents = readVisibleDirents(current)
  } catch {
    // 搜索时遇到无权限或并发删除的目录直接跳过，不打断整个搜索。
    return
  }
  for (const dirent of dirents) {
    if (SKIPPED_SEARCH_DIRS.has(dirent.name)) continue
    const childDepth = depth + 1
    if (childDepth > MAX_SEARCH_DEPTH) {
      budget.truncated = true
      continue
    }
    if (dirent.name.toLowerCase().includes(query)) {
      results.push(entryFor(current, relPath, dirent.name))
      if (results.length >= MAX_SEARCH_RESULTS) {
        budget.truncated = true
        budget.stop = true
        return
      }
    }
    if (childDepth < MAX_SEARCH_DEPTH) {
      searchDirectories(
        join(current, dirent.name),
        joinRel(relPath, dirent.name),
        query,
        childDepth,
        results,
        budget,
      )
      if (budget.stop) return
    } else if (hasVisibleChildren(join(current, dirent.name), budget)) {
      // 已到深度上限且下面还有目录：标记不完整，但继续搜索同级目录。
      budget.truncated = true
      if (budget.stop) return
    }
  }
}

/**
 * 在 workspacesRoot 内浏览目录。只返回相对路径，调用方不能靠这个接口探测 root 之外的目录。
 * 搜索从当前 path 开始向下递归，有深度与结果上限；直接浏览则列出当前目录的全部可见子目录。
 */
export function browseWorkspaceDirectories(input: {
  root: string
  path?: string
  q?: string
}): WorkspaceBrowseResponse {
  let realRoot: string
  try {
    realRoot = realpathSync(input.root)
  } catch {
    throw appError('invalid_path', 'workspace root not found')
  }

  const requested = input.path?.trim() ?? ''
  const current = requested ? resolveWorkspaceDir(realRoot, requested) : realRoot
  const relPath = requested ? toWorkspaceRelPath(realRoot, current) : ''
  const query = input.q?.trim().toLowerCase() ?? ''
  const searching = query.length > 0

  let entries: WorkspaceBrowseEntry[]
  let truncated: boolean
  if (searching) {
    entries = []
    const budget: SearchBudget = { visits: 0, truncated: false, stop: false }
    searchDirectories(current, relPath, query, 0, entries, budget)
    truncated = budget.truncated
    entries.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-Hans-CN'))
  } else {
    ;({ entries, truncated } = listDirectories(current, relPath))
  }

  const parent = relPath ? (dirname(relPath) === '.' ? '' : dirname(relPath)) : null
  return {
    path: relPath,
    parent,
    entries,
    truncated,
    searching,
  }
}
