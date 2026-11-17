import type { FastifyInstance } from 'fastify'
import type { Config } from '../config.js'
import { tokenFromRequest, tokensEqual } from './token.js'

/** /api/health 保持公开；其余 /api/* 在配置 token 时必须带 Bearer、cookie 或 query token。 */
export function registerApiAuth(app: FastifyInstance, config: Config): void {
  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0] ?? ''
    if (!path.startsWith('/api/') || path === '/api/health') {
      return
    }
    if (!config.token) {
      return
    }
    if (!tokensEqual(tokenFromRequest(req), config.token)) {
      return reply.code(401).send({ code: 'unauthorized', message: 'invalid or missing token' })
    }
  })
}
