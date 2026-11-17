import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Config } from '../config.js'

function setSessionCookie(reply: FastifyReply, token: string): FastifyReply {
  return reply.setCookie('baton_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  })
}

export function registerAuth(app: FastifyInstance, config: Config, hasWeb: boolean): void {
  app.get('/auth', async (req, reply) => {
    const token = (req.query as { token?: string }).token
    if (!config.token || token !== config.token) {
      return reply.code(401).send({ code: 'unauthorized', message: 'invalid or missing token' })
    }
    return setSessionCookie(reply, token).redirect('/')
  })

  app.get('/', async (req, reply) => {
    const token = (req.query as { token?: string }).token
    if (token && config.token && token === config.token) {
      return setSessionCookie(reply, token).redirect('/')
    }
    if (hasWeb) {
      return reply.sendFile('index.html')
    }
    return reply.type('text/html').send('<h1>baton</h1>')
  })
}
