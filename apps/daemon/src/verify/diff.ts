import type { DiffFile, DiffSnapshot } from '@baton/protocol'
import { execa } from 'execa'

const MAX_FILE_PATCH = 128 * 1024
const MAX_TOTAL_PATCH = 512 * 1024

interface ChangedFile {
  path: string
  oldPath?: string
  status: DiffFile['status']
  untracked: boolean
}

interface FileStats {
  binary: boolean
  insertions: number
  deletions: number
}

function emptySnapshot(now: () => number): DiffSnapshot {
  return { v: 1, capturedAt: now(), baseRef: 'HEAD', truncated: false, files: [] }
}

async function git(args: string[], cwd: string) {
  return execa('git', ['-C', cwd, ...args], { reject: false })
}

function parseStatus(output: string): ChangedFile[] {
  const tokens = output.split('\0')
  const files: ChangedFile[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue
    const code = token.slice(0, 2)
    const path = token.slice(3)
    if (!path) continue
    if (code[0] === 'R' || code[1] === 'R' || code[0] === 'C' || code[1] === 'C') {
      const oldPath = tokens[index + 1]
      index += 1
      files.push({
        path,
        ...(oldPath ? { oldPath } : {}),
        status: code.includes('R') ? 'renamed' : 'modified',
        untracked: false,
      })
      continue
    }
    if (code === '??') {
      files.push({ path, status: 'added', untracked: true })
      continue
    }
    if (code.includes('A')) {
      files.push({ path, status: 'added', untracked: false })
    } else if (code.includes('D')) {
      files.push({ path, status: 'deleted', untracked: false })
    } else if (code.includes('M') || code.includes('T')) {
      files.push({ path, status: 'modified', untracked: false })
    } else if (code.includes('U')) {
      files.push({ path, status: 'modified', untracked: false })
    }
  }
  return files
}

function parseStats(output: string): FileStats {
  const [added, deleted] = (output.split('\n')[0] ?? '').split('\t')
  if (added === '-' || deleted === '-') {
    return { binary: true, insertions: 0, deletions: 0 }
  }
  return {
    binary: false,
    insertions: Number(added) || 0,
    deletions: Number(deleted) || 0,
  }
}

async function readStats(cwd: string, file: ChangedFile): Promise<FileStats> {
  const args = file.untracked
    ? ['diff', '--no-index', '--numstat', '--', '/dev/null', file.path]
    : file.oldPath
      ? ['diff', '--numstat', '--find-renames', 'HEAD', '--', file.oldPath, file.path]
      : ['diff', '--numstat', 'HEAD', '--', file.path]
  const result = await git(args, cwd)
  return parseStats(result.stdout)
}

async function readPatch(cwd: string, file: ChangedFile): Promise<string> {
  const args = file.untracked
    ? [
        'diff',
        '--no-index',
        '--no-color',
        '--no-ext-diff',
        '--unified=3',
        '--',
        '/dev/null',
        file.path,
      ]
    : [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--unified=3',
        '--find-renames',
        'HEAD',
        '--',
        ...(file.oldPath ? [file.oldPath, file.path] : [file.path]),
      ]
  const result = await git(args, cwd)
  return result.stdout
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) {
    return { value, truncated: false }
  }
  let end = maxBytes
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) {
    end -= 1
  }
  return { value: bytes.subarray(0, end).toString('utf8'), truncated: true }
}

/**
 * 捕获工作区相对 HEAD 的改动。逐个文件取 patch，避免一次性解析大 diff；
 * 单文件与总量都设上限，截断可见，不静默丢内容。
 */
export async function captureDiff(workspacePath: string, now: () => number): Promise<DiffSnapshot> {
  const inside = await git(['rev-parse', '--is-inside-work-tree'], workspacePath)
  if (inside.exitCode !== 0) {
    return emptySnapshot(now)
  }
  const status = await git(['status', '--porcelain=v1', '-uall', '-z'], workspacePath)
  if (status.exitCode !== 0) {
    return emptySnapshot(now)
  }

  const files: DiffFile[] = []
  let totalBytes = 0
  let truncated = false

  for (const changed of parseStatus(status.stdout)) {
    const stats = await readStats(workspacePath, changed)
    const rawPatch = stats.binary ? '' : await readPatch(workspacePath, changed)
    const perFile = truncateUtf8(rawPatch, MAX_FILE_PATCH)
    if (perFile.truncated) truncated = true

    const remaining = MAX_TOTAL_PATCH - totalBytes
    let patch = perFile.value
    if (remaining <= 0) {
      patch = ''
      truncated = true
    } else if (Buffer.byteLength(patch, 'utf8') > remaining) {
      patch = truncateUtf8(patch, remaining).value
      truncated = true
    }
    totalBytes += Buffer.byteLength(patch, 'utf8')

    files.push({
      path: changed.path,
      ...(changed.oldPath ? { oldPath: changed.oldPath } : {}),
      status: stats.binary ? 'binary' : changed.status,
      insertions: stats.insertions,
      deletions: stats.deletions,
      patch,
    })
  }

  return {
    v: 1,
    capturedAt: now(),
    baseRef: 'HEAD',
    truncated,
    files,
  }
}
