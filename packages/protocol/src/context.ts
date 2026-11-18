import { z } from 'zod'
import { Id } from './common.js'
import { EdgeType, NodeType } from './enums.js'

export const DropReason = z.enum(['budget', 'sensitive', 'limit', 'not_found', 'target', 'empty'])
export type DropReason = z.infer<typeof DropReason>

export const ContextNodeRef = z.object({
  id: Id,
  type: NodeType,
  title: z.string(),
  depth: z.number().int().nonnegative(),
  chars: z.number().int().nonnegative(),
})
export type ContextNodeRef = z.infer<typeof ContextNodeRef>

export const ContextDropped = z.object({
  id: Id,
  reason: DropReason,
  title: z.string().optional(),
})
export type ContextDropped = z.infer<typeof ContextDropped>

export const ContextRelation = z.object({
  from: Id,
  to: Id,
  type: EdgeType,
  fromTitle: z.string(),
  toTitle: z.string(),
  includedFrom: z.boolean(),
  includedTo: z.boolean(),
})
export type ContextRelation = z.infer<typeof ContextRelation>

export const ContextSnapshot = z.object({
  included: z.array(ContextNodeRef),
  dropped: z.array(ContextDropped),
  truncated: z.boolean(),
  redactedPaths: z.array(z.string()),
  relations: z.array(ContextRelation),
  relationsTruncated: z.boolean(),
})
export type ContextSnapshot = z.infer<typeof ContextSnapshot>
