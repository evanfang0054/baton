import { buildApp } from './app.js'
import { loadConfig } from './config.js'

async function main(): Promise<void> {
  const config = loadConfig(process.argv.slice(2), process.env)
  const app = await buildApp(config)
  await app.listen({ host: config.host, port: config.port })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : config.port
  console.log(`baton listening on http://${config.host}:${port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
