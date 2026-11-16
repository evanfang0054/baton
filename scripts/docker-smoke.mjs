import { execFileSync, spawnSync } from 'node:child_process'

const image = 'baton:m0'
const container = 'baton-smoke'

execFileSync('docker', ['build', '-t', image, '.'], { stdio: 'inherit' })
execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' })

const run = spawnSync(
  'docker',
  ['run', '-d', '--name', container, '-e', 'BATON_TOKEN=test', '-p', '7397:7317', image],
  { encoding: 'utf8' },
)
if (run.status !== 0) throw new Error(run.stderr || 'docker run failed')

try {
  let healthy = false
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:7397/api/health')
      if (res.ok) {
        healthy = true
        break
      }
    } catch {
      // container still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!healthy) {
    console.error(execFileSync('docker', ['logs', container], { encoding: 'utf8' }))
    throw new Error('health check timed out')
  }

  const uid = execFileSync('docker', ['exec', container, 'id', '-u'], { encoding: 'utf8' }).trim()
  if (uid === '0') throw new Error('container runs as root')

  const size = Number(
    execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Size}}'], {
      encoding: 'utf8',
    }).trim(),
  )
  const megabytes = size / 1048576
  console.log(`docker smoke ok (uid=${uid}, image=${megabytes.toFixed(0)}MB)`)
  if (megabytes > 700) throw new Error(`image exceeds 700MB (${megabytes.toFixed(0)}MB)`)
} finally {
  execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
}
