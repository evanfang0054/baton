import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const names = ['HealthResponse', 'WsEnvelope', 'WsPing', 'WsPong', 'Config']
const pattern = new RegExp(`export\\s+(type|interface)\\s+(${names.join('|')})\\b`)
const roots = ['apps', 'packages']

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'migrations') {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
  }
  return files
}

const violations = []
for (const root of roots) {
  for (const file of walk(root)) {
    if (file.startsWith(join('packages', 'protocol'))) continue
    if (pattern.test(readFileSync(file, 'utf8'))) violations.push(file)
  }
}

if (violations.length > 0) {
  console.error('protocol types must be defined only in packages/protocol:')
  for (const file of violations) console.error(`- ${file}`)
  process.exit(1)
}

console.log('protocol single-source ok')
