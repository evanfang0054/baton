import { cpSync, existsSync, mkdirSync } from 'node:fs'

if (!existsSync('migrations')) throw new Error('migrations directory missing')
mkdirSync('dist', { recursive: true })
cpSync('migrations', 'dist/migrations', { recursive: true })
