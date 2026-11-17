import { bootstrap } from './bootstrap.js'
import { loadConfig } from './config.js'

export async function start(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const config = loadConfig(argv, env)
  const { app, db, runtime, logger } = await bootstrap(config)
  await app.listen({ host: config.host, port: config.port })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : config.port
  runtime.start()
  logger.info({ host: config.host, port }, 'baton listening')

  const shutdown = async (): Promise<void> => {
    await app.close()
    db.close()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

export function reportStartupError(err: unknown): void {
  const message = err instanceof Error ? err.message : 'startup failed'
  console.error(`baton failed to start: ${message}`)
  if (process.env.BATON_DEBUG === '1' && err instanceof Error) {
    console.error(err.stack)
  }
  process.exit(1)
}
