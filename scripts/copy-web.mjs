import { cpSync, existsSync, mkdirSync } from 'node:fs'

if (!existsSync('apps/web/dist')) throw new Error('apps/web/dist missing; run the web build first')
mkdirSync('apps/daemon/dist', { recursive: true })
cpSync('apps/web/dist', 'apps/daemon/dist/web', { recursive: true })
