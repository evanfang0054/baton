import type { AppError } from '@baton/protocol'

export function appError(code: string, message: string, details?: unknown): AppError {
  return details === undefined ? { code, message } : { code, message, details }
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}

export function toAppError(error: unknown, fallback = 'internal'): AppError {
  if (isAppError(error)) return error
  return appError(fallback, error instanceof Error ? error.message : 'unexpected error')
}
