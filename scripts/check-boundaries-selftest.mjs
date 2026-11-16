import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const file = 'packages/core/src/__fixture_fs.ts'
mkdirSync('packages/core/src', { recursive: true })
writeFileSync(file, "import 'node:fs'\n")

try {
  let output = ''
  try {
    output = execFileSync('pnpm', ['check:boundaries'], { encoding: 'utf8', stdio: 'pipe' })
  } catch (err) {
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  if (!output.includes('core-no-node-builtins')) {
    throw new Error(`boundary rule did not fire on the fixture:\n${output}`)
  }
  console.log('boundaries selftest ok')
} finally {
  rmSync(file, { force: true })
}
