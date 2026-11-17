import type { FastifyInstance } from 'fastify'
import { appError, isAppError } from '../errors.js'

const STATUS_BY_CODE: Record<string, number> = {
  invalid_payload: 400,
  invalid_path: 400,
  unsupported_workspace_mode: 400,
  unsupported_engine: 400,
  invalid_policy: 400,
  unauthorized: 401,
  not_found: 404,
  workspace_not_found: 404,
  canvas_not_found: 404,
  node_not_found: 404,
  task_not_found: 404,
  approval_not_found: 404,
  review_not_found: 404,
  session_not_found: 404,
  conflict: 409,
  invalid_transition: 409,
  guard_failed: 409,
  approval_expired: 409,
  already_decided: 409,
  review_expired: 409,
}

function statusFor(code: string): number {
  return STATUS_BY_CODE[code] ?? 500
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _req, reply) => {
    // Fastify 自带错误（如非法 JSON）带 statusCode，不能被降级成 500。
    const statusCode = (error as { statusCode?: unknown }).statusCode
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      reply
        .code(statusCode)
        .send(
          appError(statusCode === 400 ? 'invalid_payload' : 'invalid_request', 'invalid request'),
        )
      return
    }
    const value = isAppError(error) ? error : appError('internal', 'unexpected error')
    reply.code(statusFor(value.code)).send(value)
  })
}
