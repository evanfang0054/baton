import { reportStartupError, start } from './start.js'

start().catch(reportStartupError)
