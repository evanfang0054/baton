import type { AppError } from '@baton/protocol'

export interface VerifyCommandInput {
  taskCommand?: string
  policyCommand?: string
  packageScripts?: Readonly<Record<string, string>>
  packageManager?: 'pnpm' | 'npm' | 'yarn'
}

export type VerifyCommandSource = 'task' | 'policy' | 'package' | 'fallback'

export type VerifyCommandResult =
  | { ok: true; command: string; source: VerifyCommandSource }
  | { ok: false; error: AppError }
