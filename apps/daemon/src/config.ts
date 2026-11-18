import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { ConfigSchema, type Config } from '@baton/protocol'

export type { Config }

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

function readTokenFile(file: string): string {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    throw new Error(`cannot read BATON_TOKEN_FILE: ${basename(file)}`)
  }
}

function envFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Config {
  const home = env.HOME ?? homedir()
  const tokenFile = env.BATON_TOKEN_FILE
  const token = env.BATON_TOKEN ?? (tokenFile ? readTokenFile(tokenFile) : null)
  const config = ConfigSchema.parse({
    host: argValue(argv, '--host') ?? env.BATON_HOST ?? '127.0.0.1',
    port: Number(argValue(argv, '--port') ?? env.BATON_PORT ?? 7317),
    token: token && token.length > 0 ? token : null,
    dataDir: env.BATON_DATA_DIR ?? join(home, '.baton'),
    webRoot: env.BATON_WEB_ROOT ?? join(process.cwd(), 'apps/web/dist'),
    workspacesRoot: env.BATON_WORKSPACES_ROOT ?? home,
    maxConcurrency: Number(env.BATON_MAX_CONCURRENCY ?? 1),
    maxLiveSessions: Number(env.BATON_MAX_LIVE_SESSIONS ?? 5),
    killSwitch: envFlag(env.BATON_KILL_SWITCH),
  })
  if (config.host !== '127.0.0.1' && !config.token) {
    throw new Error('BATON_TOKEN is required when binding a non-loopback host')
  }
  return config
}
