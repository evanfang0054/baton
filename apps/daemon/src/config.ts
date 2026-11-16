import { join } from 'node:path'

export interface Config {
  host: string
  port: number
  token: string | null
  dataDir: string
  webRoot: string
}

export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Config {
  let host = '127.0.0.1'
  let port = 7317
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--host') host = argv[i + 1] ?? host
    if (argv[i] === '--port') port = Number(argv[i + 1] ?? port)
  }
  const token = env.BATON_TOKEN ?? null
  if (host !== '127.0.0.1' && !token) {
    throw new Error('BATON_TOKEN is required when binding a non-loopback host')
  }
  return {
    host,
    port,
    token,
    dataDir: env.BATON_DATA_DIR ?? `${env.HOME ?? '.'}/.baton`,
    webRoot: env.BATON_WEB_ROOT ?? join(process.cwd(), 'apps/web/dist'),
  }
}
