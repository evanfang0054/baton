import { PolicySchema } from '../packages/protocol/src/index.js'
import { ClaudeAdapter } from '../packages/adapters/src/claude/adapter.js'

const adapter = new ClaudeAdapter({ maxTurns: 5, maxBudgetUsd: 0.2 })

const run = await adapter.start({
  prompt: 'Reply with exactly the word pong, then call baton_report with outcome ready.',
  cwd: process.cwd(),
  permissionMode: 'manual',
  policy: PolicySchema.parse({}),
  workspaceTrust: { projectSettings: false, projectHooks: false },
})

const seen: string[] = []
let finished = false
const timeout = new Promise<void>((resolve) => setTimeout(resolve, 120_000))

const consume = (async () => {
  for await (const event of run.events) {
    seen.push(
      event.type === 'CUSTOM' ? `CUSTOM:${event.name}:${JSON.stringify(event.value)}` : event.type,
    )
    if (event.type === 'TEXT_MESSAGE_CONTENT') {
      process.stdout.write(event.delta)
    }
    if (event.type === 'RUN_ERROR') {
      console.error('RUN_ERROR:', event.message)
    }
    if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') {
      finished = true
      break
    }
  }
})()

await Promise.race([consume, timeout])
if (!finished) {
  await run.interrupt().catch(() => {})
}
await run.dispose().catch(() => {})
console.log('\nSPIKE_EVENTS', JSON.stringify(seen))
console.log('SPIKE_FINISHED', finished)
if (!finished) process.exitCode = 1
