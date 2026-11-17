import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  relPath: text('rel_path').notNull().unique(),
  createdAt: integer('created_at').notNull(),
})

export const canvas = sqliteTable('canvas', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspace.id),
  viewportJson: text('viewport_json').notNull().default('{}'),
})

export const node = sqliteTable(
  'node',
  {
    id: text('id').primaryKey(),
    canvasId: text('canvas_id')
      .notNull()
      .references(() => canvas.id),
    type: text('type').notNull(),
    x: real('x').notNull(),
    y: real('y').notNull(),
    w: real('w').notNull().default(320),
    h: real('h').notNull().default(200),
    groupId: text('group_id'),
    dataJson: text('data_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('node_canvas_idx').on(t.canvasId)],
)

export const edge = sqliteTable('edge', {
  id: text('id').primaryKey(),
  canvasId: text('canvas_id')
    .notNull()
    .references(() => canvas.id),
  sourceId: text('source_id')
    .notNull()
    .references(() => node.id),
  targetId: text('target_id')
    .notNull()
    .references(() => node.id),
  type: text('type').notNull().default('context'),
})

export const task = sqliteTable(
  'task',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    nodeId: text('node_id').references(() => node.id),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    status: text('status').notNull(),
    waitingReason: text('waiting_reason'),
    engine: text('engine').notNull(),
    workspaceMode: text('workspace_mode').notNull().default('main'),
    branch: text('branch'),
    worktreePath: text('worktree_path'),
    verifyCommand: text('verify_command'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('task_status_idx').on(t.status)],
)

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => task.id),
  adapter: text('adapter').notNull(),
  engineSessionId: text('engine_session_id'),
  status: text('status').notNull(),
  outcome: text('outcome'),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
})

export const event = sqliteTable(
  'event',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id),
    ordinal: integer('ordinal').notNull(),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    ts: integer('ts').notNull(),
  },
  (t) => [
    uniqueIndex('event_session_seq_idx').on(t.sessionId, t.seq),
    uniqueIndex('event_ordinal_idx').on(t.ordinal),
  ],
)

export const wsEvent = sqliteTable(
  'ws_event',
  {
    ordinal: integer('ordinal').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    ts: integer('ts').notNull(),
  },
  (t) => [index('ws_event_ts_idx').on(t.ts)],
)

export const approval = sqliteTable(
  'approval',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id),
    requestId: text('request_id'),
    requestJson: text('request_json').notNull(),
    decision: text('decision'),
    decidedBy: text('decided_by'),
    decidedAt: integer('decided_at'),
  },
  (t) => [index('approval_session_request_idx').on(t.sessionId, t.requestId)],
)

export const review = sqliteTable('review', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => task.id),
  verdict: text('verdict'),
  verifyExitCode: integer('verify_exit_code'),
  verifyOutput: text('verify_output'),
  diffStatJson: text('diff_stat_json'),
  decidedAt: integer('decided_at'),
})

export const audit = sqliteTable(
  'audit',
  {
    id: text('id').primaryKey(),
    ts: integer('ts').notNull(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    detailJson: text('detail_json').notNull(),
  },
  (t) => [index('audit_ts_idx').on(t.ts)],
)

export const notice = sqliteTable('notice', {
  id: text('id').primaryKey(),
  ts: integer('ts').notNull(),
  kind: text('kind').notNull(),
  payloadJson: text('payload_json').notNull(),
  readAt: integer('read_at'),
})
