import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

const dirs: string[] = []

afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

async function appWithWeb(token: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'baton-web-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'index.html'), '<h1>app</h1>')
  return buildApp({
    host: '127.0.0.1',
    port: 0,
    token,
    dataDir: '/tmp',
    webRoot: dir,
    workspacesRoot: '/tmp',
    maxConcurrency: 1,
  })
}

describe('static and pairing', () => {
  it('serves the built index for /', async () => {
    const app = await appWithWeb('secret')
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<h1>app</h1>')
    await app.close()
  })

  it('sets an httpOnly cookie and redirects when the token matches', async () => {
    const app = await appWithWeb('secret')
    const res = await app.inject({ method: 'GET', url: '/?token=secret' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/')
    expect(String(res.headers['set-cookie'])).toContain('baton_token=secret')
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly')
    await app.close()
  })

  it('rejects a wrong token on /auth', async () => {
    const app = await appWithWeb('secret')
    const res = await app.inject({ method: 'GET', url: '/auth?token=wrong' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns JSON 404 for unknown api routes', async () => {
    const app = await appWithWeb('secret')
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'not_found' })
    await app.close()
  })
})
