import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'baton-pack-'))
let child

try {
  execFileSync('pnpm', ['build'], { stdio: 'inherit' })
  execFileSync('pnpm', ['--filter', '@evanfang0054/baton', 'pack', '--pack-destination', dir], {
    stdio: 'inherit',
  })
  const tarball = readdirSync(dir).find((file) => file.endsWith('.tgz'))
  if (!tarball) throw new Error('tarball not produced')

  const project = join(dir, 'project')
  execFileSync('mkdir', ['-p', project])
  execFileSync('npm', ['init', '-y'], { cwd: project, stdio: 'ignore' })
  execFileSync('npm', ['install', join(dir, tarball)], { cwd: project, stdio: 'inherit' })

  child = spawn('npx', ['baton', '--port', '7398'], {
    cwd: project,
    stdio: 'inherit',
    env: { ...process.env, BATON_DATA_DIR: join(project, '.data') },
  })

  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:7398/api/health')
      if (res.ok) {
        console.log('pack-check ok')
        child.kill()
        process.exit(0)
      }
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('health check timeout')
} finally {
  child?.kill()
  rmSync(dir, { recursive: true, force: true })
}
