export type PackageManager = 'pnpm' | 'npm' | 'yarn'

export interface PackageManagerInput {
  /** `package.json` 的 packageManager 字段；可能指向未安装的版本。 */
  packageManager?: string
  /** 判断 workspace 根目录下是否存在某个文件（锁文件等）。 */
  hasFile: (name: string) => boolean
}

/**
 * 选出项目自己的包管理器。
 *
 * packageManager 字段优先；缺失时看锁文件。都没有时用 npm：Node 自带，并且
 * corepack 不会像 pnpm 那样在 verify 时把 packageManager 写回用户仓库。
 */
export function detectPackageManager(input: PackageManagerInput): PackageManager {
  const declared = input.packageManager
  if (typeof declared === 'string') {
    if (declared.startsWith('pnpm@')) return 'pnpm'
    if (declared.startsWith('yarn@')) return 'yarn'
    if (declared.startsWith('npm@')) return 'npm'
  }

  if (input.hasFile('pnpm-lock.yaml') || input.hasFile('pnpm-workspace.yaml')) return 'pnpm'
  if (input.hasFile('yarn.lock')) return 'yarn'
  if (input.hasFile('package-lock.json') || input.hasFile('npm-shrinkwrap.json')) return 'npm'

  return 'npm'
}
