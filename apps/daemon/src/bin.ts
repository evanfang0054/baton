#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { reportStartupError, start } from './start.js'

process.env.BATON_WEB_ROOT ??= fileURLToPath(new URL('./web', import.meta.url))
process.env.BATON_MIGRATIONS_DIR ??= fileURLToPath(new URL('./migrations', import.meta.url))

start().catch(reportStartupError)
