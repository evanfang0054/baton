import { attentionFor } from '@baton/core'
import { TaskDetailResponse, TaskListQuery, TaskListResponse, type Task } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import {
  getReviewByTask,
  getTaskDetail,
  listApprovalsByTask,
  listSessionsByTask,
  listTasks,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import type { Logger } from '../log.js'

function waitingSinceFor(task: Task): number | null {
  return task.status === 'waiting_input' || task.status === 'review' ? task.updatedAt : null
}

export function registerTaskRoutes(app: FastifyInstance, deps: { db: Db; logger: Logger }): void {
  app.get('/api/tasks', async (req) => {
    const parsed = TaskListQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid task query', parsed.error.issues)
    }
    const tasks = listTasks(deps.db, parsed.data).map((task) => ({
      ...task,
      attention: attentionFor(task.status, task.waitingReason),
      waitingSince: waitingSinceFor(task),
    }))
    return TaskListResponse.parse({ tasks })
  })

  app.get('/api/tasks/:id', async (req) => {
    const params = req.params as { id?: string }
    if (!params.id) {
      throw appError('invalid_payload', 'task id is required')
    }
    const detail = getTaskDetail(deps.db, params.id)
    if (!detail) {
      throw appError('task_not_found', 'task not found', { taskId: params.id })
    }
    if (detail.contextInvalid) {
      deps.logger.warn(
        { event: 'context_snapshot_invalid', taskId: params.id },
        'context snapshot invalid',
      )
    }
    const task = detail.task
    return TaskDetailResponse.parse({
      task,
      contextInvalid: detail.contextInvalid,
      sessions: listSessionsByTask(deps.db, task.id),
      approvals: listApprovalsByTask(deps.db, task.id),
      review: getReviewByTask(deps.db, task.id),
      waitingSince: waitingSinceFor(task),
      attention: attentionFor(task.status, task.waitingReason),
    })
  })
}
