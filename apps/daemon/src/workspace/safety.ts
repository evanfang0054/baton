import { realpathSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/**
 * 自动批准的文件写入必须在真实路径上仍位于 workspace 内。
 * 词法路径无法发现 `src/link -> $HOME` 这类 symlink 逃逸；这里从目标向上
 * 找到最近的已存在祖先做 realpath，再比较工作区真实路径。
 */
export function writeEscapesWorkspace(
  workspacePath: string,
  toolName: string,
  input: unknown,
): boolean {
  if (!WRITE_TOOLS.has(toolName)) return false
  const record = input as { file_path?: unknown; path?: unknown } | null
  const target = record?.file_path ?? record?.path
  if (typeof target !== 'string' || target.length === 0) return false

  let root: string
  try {
    root = realpathSync(workspacePath).replace(/\/+$/, '')
  } catch {
    // 工作区已不可访问时不能自动放行写入。
    return true
  }
  let probe = resolve(workspacePath, target)
  for (;;) {
    try {
      const real = realpathSync(probe)
      return real !== root && !real.startsWith(`${root}${sep}`)
    } catch {
      const parent = dirname(probe)
      if (parent === probe) return true
      probe = parent
    }
  }
}
