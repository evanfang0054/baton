import { z } from 'zod'
import { ArtifactKind } from './artifact.js'

export const PlaybookStage = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  label: z.string().min(1).max(40),
  skill: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .nullable()
    .default(null),
  gate: z.enum(['human', 'auto']),
  produces: z
    .array(
      z.object({
        kind: ArtifactKind,
        name: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
        required: z.boolean().default(false),
      }),
    )
    .max(8)
    .default([]),
  acceptance: z
    .object({
      checklist: z.array(z.string().min(1).max(200)).max(8).default([]),
      verify: z.boolean().default(true),
    })
    .default({ checklist: [], verify: true }),
})
export type PlaybookStage = z.infer<typeof PlaybookStage>

export const Playbook = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  version: z.number().int().positive(),
  label: z.string().min(1).max(40),
  description: z.string().max(500).optional(),
  stages: z.array(PlaybookStage).min(1).max(8),
})
export type Playbook = z.infer<typeof Playbook>
