import { WorkspaceUploadResponse } from '@baton/protocol'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
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

describe('GET /api/workspaces/:id/uploads/:name', () => {
  it('serves an uploaded image with security headers', async () => {
    const { app, handle } = await setup()
    const upload = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${handle.seeded.workspaceId}/uploads`,
      payload: {
        name: 'a.png',
        mime: 'image/png',
        dataBase64: Buffer.from('png-bytes').toString('base64'),
      },
    })
    const file = WorkspaceUploadResponse.parse(upload.json()).file
    const name = file.path.split('/').at(-1)
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${handle.seeded.workspaceId}/uploads/${name}`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toBe('private, max-age=300')
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength('png-bytes')))
  })

  it('adds CSP sandbox for SVG and rejects non-image extensions', async () => {
    const { app, handle } = await setup()
    const svg = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${handle.seeded.workspaceId}/uploads`,
      payload: {
        name: 'a.svg',
        mime: 'image/svg+xml',
        dataBase64: Buffer.from('<svg/>').toString('base64'),
      },
    })
    const svgName = WorkspaceUploadResponse.parse(svg.json()).file.path.split('/').at(-1)
    const svgRes = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${handle.seeded.workspaceId}/uploads/${svgName}`,
    })
    expect(svgRes.statusCode).toBe(200)
    expect(svgRes.headers['content-security-policy']).toContain('sandbox')

    const txt = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${handle.seeded.workspaceId}/uploads`,
      payload: { name: 'a.txt', dataBase64: Buffer.from('a').toString('base64') },
    })
    const txtName = WorkspaceUploadResponse.parse(txt.json()).file.path.split('/').at(-1)
    const txtRes = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${handle.seeded.workspaceId}/uploads/${txtName}`,
    })
    expect(txtRes.statusCode).toBe(415)
  })

  it('rejects traversal and missing files', async () => {
    const { app, handle } = await setup()
    for (const name of ['..%2Fsecret.png', 'missing.png']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/workspaces/${handle.seeded.workspaceId}/uploads/${name}`,
      })
      expect(res.statusCode).toBe(404)
    }
  })

  it('rejects symlinks, directories, and FIFO entries', async () => {
    const { app, handle } = await setup()
    const workspacePath = join(handle.root, handle.seeded.relPath)
    const uploadDir = join(workspacePath, '.baton', 'uploads')
    mkdirSync(uploadDir, { recursive: true })
    writeFileSync(join(handle.root, 'outside.png'), 'png-bytes')
    symlinkSync(join(handle.root, 'outside.png'), join(uploadDir, 'link.png'))
    mkdirSync(join(uploadDir, 'dir.png'))
    const names = ['link.png', 'dir.png']
    if (process.platform !== 'win32') {
      execFileSync('mkfifo', [join(uploadDir, 'pipe.png')])
      names.push('pipe.png')
    }

    for (const name of names) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/workspaces/${handle.seeded.workspaceId}/uploads/${name}`,
      })
      expect(res.statusCode).toBe(404)
    }
  })
})
