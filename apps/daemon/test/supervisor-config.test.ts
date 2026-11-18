import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerSupervisorRoutes } from '../src/http/supervisor.js'
import { loadSupervisorConfig } from '../src/supervisor/config.js'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-sup-'))
  dirs.push(dir)
  return dir
}

describe('supervisor config', () => {
  it('loads a valid config and reports missing/invalid', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'supervisor.json'),
      JSON.stringify({ baseUrl: 'https://example.com/v1', apiKey: 'sk-test', model: 'demo' }),
    )
    expect(loadSupervisorConfig(dir)).toMatchObject({
      ok: true,
      config: { model: 'demo' },
    })
    expect(loadSupervisorConfig(tempDir())).toMatchObject({
      ok: false,
      code: 'supervisor_unavailable',
    })
  })

  it('status never returns apiKey/baseUrl', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'supervisor.json'),
      JSON.stringify({ baseUrl: 'https://example.com/v1', apiKey: 'sk-test', model: 'demo' }),
    )
    const app = Fastify()
    registerSupervisorRoutes(app, { dataDir: dir, policyVersion: 'p1' })
    const res = await app.inject({ method: 'GET', url: '/api/supervisor/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      configured: true,
      model: 'demo',
      mode: 'explicit',
      policyVersion: 'p1',
    })
    expect(res.body).not.toContain('sk-test')
    expect(res.body).not.toContain('example.com')
    await app.close()
  })
})
