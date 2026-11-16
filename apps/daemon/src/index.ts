import { bootstrap } from './bootstrap.js'
import { loadConfig } from './config.js'

async function main(): Promise<void> {
  const config = loadConfig(process.argv.slice(2), process.env)
  const { app, db } = await bootstrap(config)
  await app.listen({ host: config.host, port: config.port })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : config.port
  console.log(`baton listening on http://${config.host}:${port}`)

  const shutdown = async (): Promise<void> => {
    await app.close()
    db.close()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'startup failed'
  console.error(`baton failed to start: ${message}`)
  if (process.env.BATON_DEBUG === '1' && err instanceof Error) console.error(err.stack)
  process.exit(1)
})
