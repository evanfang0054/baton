import { z } from 'zod'

export const ConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(0).max(65535),
  token: z.string().min(1).nullable(),
  dataDir: z.string().min(1),
  webRoot: z.string().min(1),
  workspacesRoot: z.string().min(1),
  maxConcurrency: z.number().int().positive().default(1),
  maxLiveSessions: z.number().int().positive().default(5),
  claudeMaxTurns: z.number().int().positive().default(30),
  claudeMaxBudgetUsd: z.number().positive().default(2),
  verifierBudgetUsd: z.number().positive().default(0.5),
  maxTaskBudgetUsd: z.number().positive().default(50),
  claudeProjectHooks: z.enum(['on', 'off']).default('on'),
  allowBypassPermissions: z.boolean().default(false),
  killSwitch: z.boolean().default(false),
})

export type Config = z.infer<typeof ConfigSchema>
