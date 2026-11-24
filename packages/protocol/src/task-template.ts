import { z } from 'zod'
import { Engine } from './enums.js'

export const TaskTemplateId = z.enum(['bugfix', 'feature', 'review', 'handoff'])
export type TaskTemplateId = z.infer<typeof TaskTemplateId>

export const TaskTemplate = z
  .object({
    id: TaskTemplateId,
    label: z.string().min(1).max(40),
    titlePattern: z.string().min(1).max(80),
    acceptanceSeed: z.array(z.string().min(1).max(200)).min(3).max(5),
    contextRules: z
      .object({
        includeSameAgent: z.boolean(),
        includeHandoffChain: z.boolean(),
        includeRecentFailures: z.boolean(),
        maxContextNodes: z.number().int().min(1).max(10),
      })
      .strict(),
    defaultEngine: Engine.nullable(),
  })
  .strict()
export type TaskTemplate = z.infer<typeof TaskTemplate>
