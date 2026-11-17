import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'

const dirs: string[] = []
const handles: TestRuntimeHandle[] = []

afterEach(async () => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

async function appWithWeb(token: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'baton-web-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'index.html'), '<h1>app</h1>')
  const { app, handle } = await buildTestApp({ config: { token, webRoot: dir } })
  handles.push(handle)
  return app
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
    const res = await app.inject({
      method: 'GET',
      url: '/api/nope',
      headers: { authorization: 'Bearer secret' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'not_found' })
    await app.close()
  })
})
