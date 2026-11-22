import { buildFailureSummary } from '@baton/core'
import { TaskFailure, type FailureStage, type FailureSummary } from '@baton/protocol'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { taskFailure } from '../db/schema.js'
import type { Db } from '../db/types.js'

export interface FailureServiceDeps {
  db: Db
  now: () => number
  newId: () => string
  workspaceRoot: (workspaceId: string) => string | null
}

export interface FailureService {
  record(input: {
    workspaceId: string
    taskId: string
    sessionId: string | null
    attempt: number
    stage: FailureStage
    message: string
    retryable: boolean
    affectedPaths?: string[]
  }): FailureSummary
  list(taskId: string, limit?: number): TaskFailure[]
  latest(taskId: string): FailureSummary | null
  latestByTaskIds(taskIds: string[]): Map<string, FailureSummary>
}

export function createFailureService(deps: FailureServiceDeps): FailureService {
  function record(input: {
    workspaceId: string
    taskId: string
    sessionId: string | null
    attempt: number
    stage: FailureStage
    message: string
    retryable: boolean
    affectedPaths?: string[]
  }): FailureSummary {
    const now = deps.now()
    const workspaceRoot = deps.workspaceRoot(input.workspaceId)
    const summary = buildFailureSummary({
      stage: input.stage,
      message: input.message,
      retryable: input.retryable,
      affectedPaths: input.affectedPaths ?? [],
      ...(workspaceRoot ? { workspaceRoot } : {}),
      now,
    })
    const id = deps.newId()
    deps.db.transaction((tx) => {
      tx.insert(taskFailure)
        .values({
          id,
          workspaceId: input.workspaceId,
          taskId: input.taskId,
          sessionId: input.sessionId,
          attempt: input.attempt,
          stage: summary.stage,
          lastError: summary.lastError,
          retryable: summary.retryable,
          affectedPathsJson: JSON.stringify(summary.affectedPaths),
          summary: summary.summary,
          createdAt: summary.createdAt,
        })
        .run()
      tx.run(sql`
        delete from task_failure
        where task_id = ${input.taskId}
          and id not in (
            select id from task_failure
            where task_id = ${input.taskId}
            order by created_at desc, rowid desc
            limit 20
          )
      `)
    })
    return summary
  }

  function list(taskId: string, limit = 3): TaskFailure[] {
    return deps.db
      .select()
      .from(taskFailure)
      .where(eq(taskFailure.taskId, taskId))
      .orderBy(desc(taskFailure.createdAt))
      .limit(Math.min(limit, 20))
      .all()
      .map((row) =>
        TaskFailure.parse({
          id: row.id,
          workspaceId: row.workspaceId,
          taskId: row.taskId,
          sessionId: row.sessionId,
          attempt: row.attempt,
          stage: row.stage,
          lastError: row.lastError,
          retryable: row.retryable,
          affectedPaths: row.affectedPathsJson ? JSON.parse(row.affectedPathsJson) : [],
          summary: row.summary,
          createdAt: row.createdAt,
        }),
      )
  }

  function latest(taskId: string): FailureSummary | null {
    return list(taskId, 1)[0] ?? null
  }

  function latestByTaskIds(taskIds: string[]): Map<string, FailureSummary> {
    if (taskIds.length === 0) return new Map()
    const rows = deps.db
      .select()
      .from(taskFailure)
      .where(inArray(taskFailure.taskId, taskIds))
      .orderBy(desc(taskFailure.createdAt))
      .all()
    const result = new Map<string, FailureSummary>()
    for (const row of rows) {
      if (!result.has(row.taskId)) {
        result.set(row.taskId, {
          stage: row.stage as FailureStage,
          lastError: row.lastError,
          retryable: row.retryable,
          affectedPaths: row.affectedPathsJson ? JSON.parse(row.affectedPathsJson) : [],
          summary: row.summary,
          createdAt: row.createdAt,
        })
      }
    }
    return result
  }

  return { record, list, latest, latestByTaskIds }
}
