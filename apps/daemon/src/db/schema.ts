import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  relPath: text('rel_path').notNull().unique(),
  trusted: integer('trusted', { mode: 'boolean' }).notNull().default(false),
  projectHooks: text('project_hooks').notNull().default('off'),
  trustedAt: integer('trusted_at'),
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

export const edge = sqliteTable(
  'edge',
  {
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
  },
  (t) => [uniqueIndex('edge_unique_idx').on(t.canvasId, t.sourceId, t.targetId, t.type)],
)

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
    dangerouslySkipPermissions: integer('dangerously_skip_permissions', { mode: 'boolean' })
      .notNull()
      .default(false),
    budgetUsd: real('budget_usd'),
    contextJson: text('context_json'),
    originJson: text('origin_json'),
    policyJson: text('policy_json'),
    enqueuedAt: integer('enqueued_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('task_status_idx').on(t.status), index('task_workspace_idx').on(t.workspaceId)],
)

export const supervisorThread = sqliteTable(
  'supervisor_thread',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    source: text('source').notNull().default('supervisor-chat'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('supervisor_thread_workspace_idx').on(t.workspaceId, t.updatedAt)],
)

export const supervisorMessage = sqliteTable(
  'supervisor_message',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => supervisorThread.id),
    role: text('role').notNull(),
    content: text('content').notNull(),
    toolCallsJson: text('tool_calls_json'),
    metaJson: text('meta_json'),
    triggerId: text('trigger_id'),
    status: text('status').notNull().default('ok'),
    errorJson: text('error_json'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('supervisor_message_trigger_idx').on(t.threadId, t.triggerId),
    index('supervisor_message_thread_idx').on(t.threadId, t.createdAt),
  ],
)

export const supervisorDecision = sqliteTable(
  'supervisor_decision',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => supervisorThread.id),
    triggerId: text('trigger_id').notNull(),
    messageId: text('message_id')
      .notNull()
      .references(() => supervisorMessage.id),
    kind: text('kind').notNull(),
    strength: text('strength').notNull(),
    mode: text('mode').notNull(),
    reason: text('reason').notNull(),
    taskId: text('task_id').references(() => task.id),
    toolCallsJson: text('tool_calls_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('supervisor_decision_trigger_idx').on(t.threadId, t.triggerId),
    index('supervisor_decision_thread_idx').on(t.threadId, t.createdAt),
  ],
)

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id),
    adapter: text('adapter').notNull(),
    engineSessionId: text('engine_session_id'),
    status: text('status').notNull(),
    outcome: text('outcome'),
    costUsd: real('cost_usd'),
    turns: integer('turns'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (t) => [index('session_task_idx').on(t.taskId)],
)

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
    taskId: text('task_id'),
  },
  (t) => [
    index('ws_event_ts_idx').on(t.ts),
    index('ws_event_task_ordinal_idx').on(t.taskId, t.ordinal),
  ],
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
    responseJson: text('response_json'),
  },
  (t) => [index('approval_session_request_idx').on(t.sessionId, t.requestId)],
)

export const review = sqliteTable(
  'review',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id),
    verdict: text('verdict'),
    verifyExitCode: integer('verify_exit_code'),
    verifyOutput: text('verify_output'),
    diffStatJson: text('diff_stat_json'),
    diffJson: text('diff_json'),
    decidedAt: integer('decided_at'),
    preliminaryVerdict: text('preliminary_verdict'),
    preliminaryReason: text('preliminary_reason'),
    preliminaryAt: integer('preliminary_at'),
  },
  (t) => [index('review_task_idx').on(t.taskId)],
)

export const acceptanceContract = sqliteTable(
  'acceptance_contract',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    createdBy: text('created_by').notNull(),
    revision: integer('revision').notNull().default(0),
    truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    frozenAt: integer('frozen_at'),
  },
  (t) => [
    uniqueIndex('acceptance_contract_task_version_idx').on(t.taskId, t.version),
    index('acceptance_contract_task_status_idx').on(t.taskId, t.status),
  ],
)

export const acceptanceItem = sqliteTable(
  'acceptance_item',
  {
    id: text('id').primaryKey(),
    contractId: text('contract_id')
      .notNull()
      .references(() => acceptanceContract.id),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    status: text('status').notNull(),
    evidence: text('evidence'),
    source: text('source').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('acceptance_item_contract_ordinal_idx').on(t.contractId, t.ordinal),
    index('acceptance_item_contract_idx').on(t.contractId),
  ],
)

export const acceptanceRun = sqliteTable(
  'acceptance_run',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id),
    contractId: text('contract_id')
      .notNull()
      .references(() => acceptanceContract.id),
    reviewId: text('review_id')
      .notNull()
      .references(() => review.id),
    verifierTaskId: text('verifier_task_id'),
    status: text('status').notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    createdAt: integer('created_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    uniqueIndex('acceptance_run_review_idx').on(t.reviewId),
    index('acceptance_run_task_created_idx').on(t.taskId, t.createdAt),
    index('acceptance_run_contract_idx').on(t.contractId),
  ],
)

export const audit = sqliteTable(
  'audit',
  {
    id: text('id').primaryKey(),
    ts: integer('ts').notNull(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    detailJson: text('detail_json').notNull(),
  },
  (t) => [index('audit_ts_idx').on(t.ts), index('audit_action_ts_idx').on(t.action, t.ts)],
)

export const notice = sqliteTable(
  'notice',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspace.id),
    ts: integer('ts').notNull(),
    kind: text('kind').notNull(),
    payloadJson: text('payload_json').notNull(),
    readAt: integer('read_at'),
  },
  (t) => [index('notice_workspace_ts_idx').on(t.workspaceId, t.ts)],
)

export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const supervisorAction = sqliteTable(
  'supervisor_action',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    threadId: text('thread_id'),
    taskId: text('task_id'),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    strength: text('strength').notNull(),
    mode: text('mode').notNull(),
    reason: text('reason').notNull(),
    payloadJson: text('payload_json').notNull(),
    resultJson: text('result_json'),
    policyVersion: text('policy_version').notNull(),
    mandateVersion: text('mandate_version'),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    appliedAt: integer('applied_at'),
    ignoredAt: integer('ignored_at'),
  },
  (t) => [
    uniqueIndex('supervisor_action_dedupe_idx').on(t.dedupeKey),
    index('supervisor_action_status_idx').on(t.workspaceId, t.status, t.createdAt),
  ],
)

export const taskFailure = sqliteTable(
  'task_failure',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id),
    sessionId: text('session_id'),
    attempt: integer('attempt').notNull(),
    stage: text('stage').notNull(),
    lastError: text('last_error').notNull(),
    retryable: integer('retryable', { mode: 'boolean' }).notNull(),
    affectedPathsJson: text('affected_paths_json'),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('task_failure_task_idx').on(t.taskId, t.createdAt)],
)
