import type { FastifyInstance } from 'fastify'
import { appError, isAppError } from '../errors.js'

const STATUS_BY_CODE: Record<string, number> = {
  invalid_payload: 400,
  invalid_path: 400,
  unsupported_workspace_mode: 400,
  worktree_unavailable: 400,
  task_active: 409,
  unsupported_engine: 400,
  engine_unavailable: 503,
  invalid_policy: 400,
  policy_write_failed: 500,
  bypass_not_allowed: 400,
  workspace_untrusted: 409,
  kill_switch_forced: 409,
  unauthorized: 401,
  not_found: 404,
  workspace_not_found: 404,
  canvas_not_found: 404,
  node_not_found: 404,
  task_not_found: 404,
  delivery_not_found: 404,
  approval_not_found: 404,
  review_not_found: 404,
  acceptance_not_found: 404,
  diff_unavailable: 404,
  image_not_found: 404,
  image_type_unsupported: 415,
  image_too_large: 413,
  payload_too_large: 413,
  image_src_invalid: 400,
  worktree_not_found: 404,
  worktree_remove_failed: 500,
  session_not_found: 404,
  notice_not_found: 404,
  digest_generation_failed: 500,
  conflict: 409,
  invalid_transition: 409,
  guard_failed: 409,
  approval_expired: 409,
  already_decided: 409,
  review_expired: 409,
  delivery_not_cancellable: 409,
  delivery_cancelled: 409,
  no_stage: 409,
  not_todo: 409,
}

function statusFor(code: string): number {
  return STATUS_BY_CODE[code] ?? 500
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _req, reply) => {
    // Fastify 自带错误（如非法 JSON）带 statusCode，不能被降级成 500。
    const statusCode = (error as { statusCode?: unknown }).statusCode
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const code =
        statusCode === 400
          ? 'invalid_payload'
          : statusCode === 413
            ? 'payload_too_large'
            : 'invalid_request'
      reply
        .code(statusCode)
        .send(
          appError(
            code,
            code === 'payload_too_large' ? 'request body too large' : 'invalid request',
          ),
        )
      return
    }
    const value = isAppError(error) ? error : appError('internal', 'unexpected error')
    reply.code(statusFor(value.code)).send(value)
  })
}
