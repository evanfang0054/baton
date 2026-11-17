import type { FastifyInstance } from 'fastify'
import { appError, isAppError } from '../errors.js'

function statusFor(code: string): number {
  if (
    code === 'invalid_payload' ||
    code === 'invalid_path' ||
    code === 'unsupported' ||
    code === 'unsupported_engine' ||
    code === 'invalid_policy'
  ) {
    return 400
  }
  if (code === 'unauthorized') return 401
  if (
    code === 'not_found' ||
    code === 'workspace_not_found' ||
    code === 'canvas_not_found' ||
    code === 'node_not_found' ||
    code === 'task_not_found' ||
    code === 'approval_not_found' ||
    code === 'review_not_found' ||
    code === 'session_not_found'
  ) {
    return 404
  }
  if (
    code === 'conflict' ||
    code === 'invalid_transition' ||
    code === 'guard_failed' ||
    code === 'approval_expired' ||
    code === 'review_already_decided'
  ) {
    return 409
  }
  return 500
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _req, reply) => {
    const value = isAppError(error) ? error : appError('internal', 'unexpected error')
    reply.code(statusFor(value.code)).send(value)
  })
}
