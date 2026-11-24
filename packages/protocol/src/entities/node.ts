import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { Engine } from '../enums.js'
import { ArtifactKind, ArtifactStatus } from './artifact.js'

const NodeBase = z.object({
  id: Id,
  canvasId: Id,
  x: z.number(),
  y: z.number(),
  w: z.number().positive().default(320),
  h: z.number().positive().default(200),
  groupId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const TextNode = NodeBase.extend({
  type: z.literal('text'),
  data: z.object({ content: z.string() }),
})

export const ImageNode = NodeBase.extend({
  type: z.literal('image'),
  data: z.object({ src: z.string().min(1), alt: z.string().optional() }),
})

export const FileNode = NodeBase.extend({
  type: z.literal('file'),
  data: z.object({
    path: z.string().min(1),
    name: z.string().min(1),
    mime: z.string().min(1).optional(),
  }),
})

export const AgentNode = NodeBase.extend({
  type: z.literal('agent'),
  data: z.object({
    title: z.string().min(1),
    engine: Engine,
    taskId: Id.nullable(),
  }),
})

export const ReviewNode = NodeBase.extend({
  type: z.literal('review'),
  data: z.object({ taskId: Id }),
})

export const GroupNode = NodeBase.extend({
  type: z.literal('group'),
  data: z.object({
    label: z.string().min(1),
    color: z.string().min(1).optional(),
    collapsed: z.boolean().default(false),
    stageKey: z.string().min(1).max(32).optional(),
  }),
})

export const ArtifactNode = NodeBase.extend({
  type: z.literal('artifact'),
  data: z.object({
    artifactId: Id,
    kind: ArtifactKind,
    title: z.string().min(1).max(120),
    path: z.string().min(1).max(1024),
    thumbnailPath: z.string().min(1).max(1024).nullable().optional(),
    status: ArtifactStatus,
  }),
})

export const DrawingNode = NodeBase.extend({
  type: z.literal('drawing'),
  data: z.object({
    artifactId: Id,
    title: z.string().min(1).max(120),
    thumbnailPath: z.string().min(1).max(1024).nullable().optional(),
    status: ArtifactStatus,
  }),
})

export const Node = z.discriminatedUnion('type', [
  TextNode,
  ImageNode,
  FileNode,
  AgentNode,
  ReviewNode,
  GroupNode,
  ArtifactNode,
  DrawingNode,
])
export type Node = z.infer<typeof Node>
