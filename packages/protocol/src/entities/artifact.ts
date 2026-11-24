import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const ArtifactKind = z.enum([
  'spec',
  'prototype',
  'design',
  'drawing',
  'report',
  'screenshot',
  'annotation',
  'other',
])
export type ArtifactKind = z.infer<typeof ArtifactKind>

export const ArtifactStatus = z.enum(['draft', 'ready', 'accepted', 'rejected'])
export type ArtifactStatus = z.infer<typeof ArtifactStatus>

export const Artifact = z.object({
  id: Id,
  workspaceId: Id,
  deliveryId: Id,
  stageKey: z.string().min(1).max(32),
  taskId: Id.nullable(),
  kind: ArtifactKind,
  name: z.string().min(1).max(120),
  path: z.string().min(1).max(1024),
  sourcePath: z.string().min(1).max(1024).nullable(),
  svgPath: z.string().min(1).max(1024).nullable(),
  mime: z.string().min(1).max(200).nullable(),
  size: z.number().int().nonnegative(),
  sha256: z.string().min(1).max(128),
  version: z.number().int().positive(),
  status: ArtifactStatus,
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Artifact = z.infer<typeof Artifact>
