import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const assets = 'apps/web/dist/assets'
const files = readdirSync(assets)
const mainChunks = files.filter((file) => /^index-.*\.js$/.test(file))
if (mainChunks.length !== 1) {
  throw new Error(`expected exactly one main index chunk, found: ${mainChunks.join(', ')}`)
}
const main = readFileSync(join(assets, mainChunks[0]), 'utf8')
if (main.includes('@excalidraw/excalidraw')) {
  throw new Error('main chunk must not contain @excalidraw/excalidraw')
}
if (!files.some((file) => file.startsWith('DrawingEditor-'))) {
  throw new Error('DrawingEditor lazy chunk is missing; Excalidraw must stay in its own chunk')
}
console.log(`bundle check ok: main=${mainChunks[0]}, excalidraw chunk present`)
