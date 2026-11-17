import { attentionFor } from '@baton/core'
import { TaskDetailResponse, TaskListQuery, TaskListResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import {
  getReviewByTask,
  getTask,
  listApprovalsByTask,
  listSessionsByTask,
  listTasks,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'

export function registerTaskRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.get('/api/tasks', async (req) => {
    const parsed = TaskListQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid task query', parsed.error.issues)
    }
    const tasks = listTasks(deps.db, parsed.data).map((task) => ({
      ...task,
      attention: attentionFor(task.status, task.waitingReason),
      waitingSince:
        task.status === 'waiting_input' || task.status === 'review' ? task.updatedAt : null,
    }))
    return TaskListResponse.parse({ tasks })
  })

  app.get('/api/tasks/:id', async (req) => {
    const params = req.params as { id?: string }
    if (!params.id) {
      throw appError('invalid_payload', 'task id is required')
    }
    const task = getTask(deps.db, params.id)
    if (!task) {
      throw appError('task_not_found', 'task not found', { taskId: params.id })
    }
    const waitingSince =
      task.status === 'waiting_input' || task.status === 'review' ? task.updatedAt : null
    return TaskDetailResponse.parse({
      task,
      sessions: listSessionsByTask(deps.db, task.id),
      approvals: listApprovalsByTask(deps.db, task.id),
      review: getReviewByTask(deps.db, task.id),
      waitingSince,
    })
  })
}
