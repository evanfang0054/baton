import type { FastifyRequest } from 'fastify'
import { timingSafeEqual } from 'node:crypto'

export function tokenFromRequest(req: FastifyRequest): string | null {
  const url = new URL(req.url, 'http://localhost')
  const query = url.searchParams.get('token')
  if (query) {
    return query
  }
  const authorization = req.headers.authorization
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7)
  }
  const cookie = req.headers.cookie
  const raw =
    typeof cookie === 'string' ? cookie.match(/(?:^|;\s*)baton_token=([^;]+)/)?.[1] : undefined
  if (!raw) {
    return null
  }
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

export function tokensEqual(left: string | null, right: string): boolean {
  if (left === null) {
    return false
  }
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
