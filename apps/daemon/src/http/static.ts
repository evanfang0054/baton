import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

export async function registerStatic(app: FastifyInstance, webRoot: string): Promise<void> {
  await app.register(fastifyStatic, { root: webRoot, wildcard: false, index: false })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ code: 'not_found' })
    }
    return reply.sendFile('index.html')
  })
}
