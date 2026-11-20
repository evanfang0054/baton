import { WorkspaceUploadResponse } from '@baton/protocol'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTestApp, type TestApp } from './helpers/app.js'

const apps: TestApp[] = []

async function setup(): Promise<TestApp> {
  const app = await buildTestApp()
  apps.push(app)
  return app
}

afterEach(async () => {
  for (const { app, handle } of apps.splice(0)) {
    await app.close()
    await handle.cleanup()
  }
})

describe('POST /api/workspaces/:id/uploads', () => {
  it('stores the file under .baton/uploads and returns a workspace-relative path', async () => {
    const { app, handle } = await setup()
    const workspacePath = join(handle.root, handle.seeded.relPath)
    const content = '# 设计稿\n'

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${handle.seeded.workspaceId}/uploads`,
      payload: {
        name: '../../设计稿.md',
        mime: 'text/markdown',
        dataBase64: Buffer.from(content).toString('base64'),
      },
    })

    expect(res.statusCode).toBe(201)
    const file = WorkspaceUploadResponse.parse(res.json()).file
    expect(file.name).toBe('设计稿.md')
    expect(file.path.startsWith('.baton/uploads/')).toBe(true)
    expect(file.mime).toBe('text/markdown')
    const target = join(workspacePath, file.path)
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe(content)
  })

  it('rejects empty uploads', async () => {
    const { app, handle } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${handle.seeded.workspaceId}/uploads`,
      payload: { name: 'empty.txt', dataBase64: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for an unknown workspace', async () => {
    const { app } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/missing/uploads',
      payload: { name: 'a.txt', dataBase64: Buffer.from('a').toString('base64') },
    })
    expect(res.statusCode).toBe(404)
  })
})
