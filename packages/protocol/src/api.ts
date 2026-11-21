import { z } from 'zod'
import { Id, Timestamp } from './common.js'
import { Attention, Engine, TaskStatus } from './enums.js'
import { TaskStatusCause } from './events.js'
import {
  AcceptanceContract,
  AcceptanceItems,
  AcceptanceReport,
  AcceptanceRun,
  Approval,
  Audit,
  Canvas,
  Edge,
  Event,
  Node,
  Notice,
  Review,
  Session,
  Task,
  TaskAcceptanceSummary,
  TaskBudgetSummary,
  TaskDetail,
  Workspace,
} from './entities/index.js'

export const WorkspaceCreateInput = z.object({
  name: z.string().min(1),
  relPath: z.string().min(1),
})
export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateInput>

export const WorkspaceListResponse = z.object({ workspaces: z.array(Workspace) })
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponse>

export const WorkspaceCreateResponse = z.object({ workspace: Workspace, canvas: Canvas })
export type WorkspaceCreateResponse = z.infer<typeof WorkspaceCreateResponse>

export const WorkspaceTrustInput = z.object({
  trusted: z.boolean(),
  projectHooks: z.enum(['off', 'on']).optional(),
})
export type WorkspaceTrustInput = z.infer<typeof WorkspaceTrustInput>

export const WorkspaceTrustResponse = z.object({ workspace: Workspace })
export type WorkspaceTrustResponse = z.infer<typeof WorkspaceTrustResponse>

export const WorkspaceCapabilitiesResponse = z.object({ worktree: z.boolean() })
export type WorkspaceCapabilitiesResponse = z.infer<typeof WorkspaceCapabilitiesResponse>

/**
 * 目录选择器只暴露 root 内的相对路径；不返回本机绝对路径。
 * path 省略表示 root，q 非空时递归搜索目录名。
 */
export const WorkspaceBrowseQuery = z.object({
  path: z.string().max(1024).optional(),
  q: z.string().trim().max(200).optional(),
})
export type WorkspaceBrowseQuery = z.infer<typeof WorkspaceBrowseQuery>

export const WorkspaceBrowseEntry = z.object({
  name: z.string().min(1),
  relPath: z.string().min(1),
  hasGit: z.boolean(),
})
export type WorkspaceBrowseEntry = z.infer<typeof WorkspaceBrowseEntry>

export const WorkspaceBrowseResponse = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(WorkspaceBrowseEntry),
  truncated: z.boolean(),
  searching: z.boolean(),
})
export type WorkspaceBrowseResponse = z.infer<typeof WorkspaceBrowseResponse>

/**
 * 外部文件先落到 workspace 的 .baton/uploads/，再以相对路径挂到 file 节点。
 * 这样上下文装配仍走同一条 workspace 读取与 jail 校验，不需要第二套文件存储。
 */
export const WorkspaceUploadInput = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(200).optional(),
  dataBase64: z.string().min(1).max(14_000_000),
})
export type WorkspaceUploadInput = z.infer<typeof WorkspaceUploadInput>

export const WorkspaceUploadResponse = z.object({
  file: z.object({
    name: z.string().min(1),
    path: z.string().min(1),
    mime: z.string().nullable(),
    size: z.number().int().nonnegative(),
  }),
})
export type WorkspaceUploadResponse = z.infer<typeof WorkspaceUploadResponse>

export const EngineStatus = z.object({
  engine: Engine,
  status: z.enum(['available', 'unknown', 'unavailable']),
  reason: z.string().optional(),
})
export type EngineStatus = z.infer<typeof EngineStatus>

export const EngineListResponse = z.object({ engines: z.array(EngineStatus) })
export type EngineListResponse = z.infer<typeof EngineListResponse>

export const CanvasQuery = z.object({ workspaceId: Id })
export type CanvasQuery = z.infer<typeof CanvasQuery>

export const CanvasResponse = z.object({
  canvas: Canvas,
  nodes: z.array(Node),
  edges: z.array(Edge),
})
export type CanvasResponse = z.infer<typeof CanvasResponse>

export const TaskListQuery = z.object({
  workspaceId: Id,
  status: TaskStatus.optional(),
})
export type TaskListQuery = z.infer<typeof TaskListQuery>

export const TaskSummary = Task.extend({
  attention: Attention,
  waitingSince: Timestamp.nullable(),
  acceptance: TaskAcceptanceSummary.nullable().default(null),
  budget: TaskBudgetSummary.nullable().default(null),
})
export type TaskSummary = z.infer<typeof TaskSummary>

export const TaskListResponse = z.object({ tasks: z.array(TaskSummary) })
export type TaskListResponse = z.infer<typeof TaskListResponse>

export const SessionEventsQuery = z.object({
  sinceSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})
export type SessionEventsQuery = z.infer<typeof SessionEventsQuery>

export const SessionEventRecord = Event.pick({
  seq: true,
  type: true,
  payload: true,
  ts: true,
})
export type SessionEventRecord = z.infer<typeof SessionEventRecord>

export const SessionEventsResponse = z.object({
  sessionId: Id,
  events: z.array(SessionEventRecord),
  nextSeq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})
export type SessionEventsResponse = z.infer<typeof SessionEventsResponse>

export const DiffFile = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: z.enum(['modified', 'added', 'deleted', 'renamed', 'binary']),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string(),
})
export type DiffFile = z.infer<typeof DiffFile>

export const DiffSnapshot = z.object({
  v: z.literal(1),
  capturedAt: Timestamp,
  baseRef: z.literal('HEAD'),
  truncated: z.boolean(),
  files: z.array(DiffFile),
})
export type DiffSnapshot = z.infer<typeof DiffSnapshot>

export const ReviewView = Review.extend({ diffAvailable: z.boolean() })
export type ReviewView = z.infer<typeof ReviewView>

export const ReviewDiffResponse = z.object({
  reviewId: Id,
  taskId: Id,
  snapshot: DiffSnapshot,
})
export type ReviewDiffResponse = z.infer<typeof ReviewDiffResponse>

export const TaskDetailResponse = z.object({
  task: TaskDetail,
  contextInvalid: z.boolean().default(false),
  originInvalid: z.boolean().default(false),
  sessions: z.array(Session),
  approvals: z.array(Approval),
  review: ReviewView.nullable(),
  waitingSince: Timestamp.nullable(),
  attention: Attention,
})
export type TaskDetailResponse = z.infer<typeof TaskDetailResponse>

export const TaskAcceptanceResponse = z.object({
  contract: AcceptanceContract,
  items: AcceptanceItems,
  run: AcceptanceRun.nullable(),
  report: AcceptanceReport,
})
export type TaskAcceptanceResponse = z.infer<typeof TaskAcceptanceResponse>

export const TaskHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  beforeOrdinal: z.coerce.number().int().nonnegative().optional(),
})
export type TaskHistoryQuery = z.infer<typeof TaskHistoryQuery>

export const TaskStatusHistoryItem = z.object({
  ordinal: z.number().int().nonnegative(),
  ts: Timestamp,
  status: TaskStatus,
  previousStatus: TaskStatus,
  retryCount: z.number().int().nonnegative(),
  cause: TaskStatusCause.optional(),
  attention: Attention.optional(),
})
export type TaskStatusHistoryItem = z.infer<typeof TaskStatusHistoryItem>

export const TaskHistoryResponse = z.object({
  taskId: Id,
  statusEvents: z.array(TaskStatusHistoryItem),
  sessions: z.array(Session),
  reviews: z.array(ReviewView),
  nextBeforeOrdinal: z.number().int().nonnegative().optional(),
})
export type TaskHistoryResponse = z.infer<typeof TaskHistoryResponse>

export const KillSwitchInput = z.object({ enabled: z.boolean() })
export type KillSwitchInput = z.infer<typeof KillSwitchInput>

export const KillSwitchResponse = z.object({
  killSwitch: z.boolean(),
  killSwitchForced: z.boolean(),
})
export type KillSwitchResponse = z.infer<typeof KillSwitchResponse>

export const NoticeListQuery = z.object({
  workspaceId: Id.optional(),
  kind: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().nonnegative().optional(),
})
export type NoticeListQuery = z.infer<typeof NoticeListQuery>

export const NoticeListResponse = z.object({
  notices: z.array(Notice),
  nextBefore: Timestamp.optional(),
})
export type NoticeListResponse = z.infer<typeof NoticeListResponse>

export const DigestGenerateResponse = z.object({ notice: Notice })
export type DigestGenerateResponse = z.infer<typeof DigestGenerateResponse>

export const AuditListQuery = z.object({
  actionPrefix: z
    .string()
    .regex(/^[a-z._]{1,64}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().nonnegative().optional(),
})
export type AuditListQuery = z.infer<typeof AuditListQuery>

export const AuditListResponse = z.object({
  entries: z.array(Audit),
  nextBefore: Timestamp.optional(),
})
export type AuditListResponse = z.infer<typeof AuditListResponse>
