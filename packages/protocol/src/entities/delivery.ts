import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { Attention, TaskStatus } from '../enums.js'
import { AnnotationSummary } from './annotation.js'
import { Artifact } from './artifact.js'
import { Playbook } from './playbook.js'

export const DeliveryStatus = z.enum([
  'draft',
  'running',
  'waiting_person',
  'blocked',
  'done',
  'cancelled',
])
export type DeliveryStatus = z.infer<typeof DeliveryStatus>

export const StageStatus = z.enum([
  'pending',
  'running',
  'waiting_person',
  'done',
  'failed',
  'cancelled',
])
export type StageStatus = z.infer<typeof StageStatus>

export const StageSummary = z.object({
  key: z.string().min(1).max(32),
  label: z.string().min(1).max(40),
  ordinal: z.number().int().positive(),
  gate: z.enum(['human', 'auto']),
  status: StageStatus,
  taskId: Id.nullable(),
  taskStatus: TaskStatus.nullable(),
  attention: Attention,
  waitingSince: Timestamp.nullable(),
  artifactCount: z.number().int().nonnegative(),
  openAnnotationCount: z.number().int().nonnegative(),
  skillId: z.string().nullable(),
  skillStatus: z.enum(['ok', 'missing', 'disabled_untrusted']).nullable(),
})
export type StageSummary = z.infer<typeof StageSummary>

export const Delivery = z.object({
  id: Id,
  workspaceId: Id,
  canvasId: Id,
  title: z.string().min(1).max(200),
  goal: z.string().max(2000),
  playbookId: z.string().min(1).max(64),
  playbookVersion: z.number().int().positive(),
  playbookJson: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  cancelledAt: Timestamp.nullable(),
})
export type Delivery = z.infer<typeof Delivery>

export const DeliverySummary = z.object({
  id: Id,
  workspaceId: Id,
  canvasId: Id,
  title: z.string().min(1).max(200),
  goal: z.string().max(2000),
  playbookId: z.string().min(1).max(64),
  playbookVersion: z.number().int().positive(),
  status: DeliveryStatus,
  currentStageKey: z.string().nullable(),
  stageProgress: z.object({
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  attention: Attention,
  waitingSince: Timestamp.nullable(),
  openAnnotationCount: z.number().int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  cancelledAt: Timestamp.nullable(),
})
export type DeliverySummary = z.infer<typeof DeliverySummary>

export const DeliveryDetail = DeliverySummary.extend({
  playbook: Playbook,
  stages: z.array(StageSummary),
  artifacts: z.array(Artifact),
  annotations: z.array(AnnotationSummary),
})
export type DeliveryDetail = z.infer<typeof DeliveryDetail>
