import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export interface SupervisorConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const Schema = z
  .object({
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    model: z.string().min(1),
  })
  .strict()

export type LoadSupervisorConfigResult =
  | { ok: true; config: SupervisorConfig }
  | { ok: false; code: 'supervisor_unavailable'; message: string }

export function loadSupervisorConfig(dataDir: string): LoadSupervisorConfigResult {
  try {
    const raw = readFileSync(join(dataDir, 'supervisor.json'), 'utf8')
    const parsed = Schema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      return { ok: false, code: 'supervisor_unavailable', message: 'invalid supervisor config' }
    }
    return { ok: true, config: parsed.data }
  } catch {
    return { ok: false, code: 'supervisor_unavailable', message: 'supervisor config missing' }
  }
}
