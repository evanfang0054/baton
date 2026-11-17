import { z } from 'zod'

export const ConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(0).max(65535),
  token: z.string().min(1).nullable(),
  dataDir: z.string().min(1),
  webRoot: z.string().min(1),
  workspacesRoot: z.string().min(1),
  maxConcurrency: z.number().int().positive().default(1),
})

export type Config = z.infer<typeof ConfigSchema>
