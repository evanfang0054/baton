import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { EventSchemas } from '../packages/protocol/src/index.js'
import { createEventStore } from '../apps/daemon/src/db/event-store.js'
import { createTestDb, seedTask } from '../apps/daemon/test/helpers/db.js'
import { makeTextEvents } from '../apps/web/src/features/tasks/transcript.fixture.js'
import { buildTranscript } from '../apps/web/src/features/tasks/transcript-model.js'

function measure(label: string, fn: () => void, iterations = 5): void {
  fn()
  const samples: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now()
    fn()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
  const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples.at(-1) ?? 0
  console.log(`${label}: mean=${mean.toFixed(2)}ms p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`)
}

const transcriptSizes = [5_000, 20_000, 50_000, 100_000]
for (const count of transcriptSizes) {
  const transcriptEvents = makeTextEvents(count)
  measure(
    `transcript full rebuild ${count}`,
    () => {
      buildTranscript(transcriptEvents)
    },
    3,
  )
}

const database = createTestDb()
const deps = { now: () => 1, newId: () => randomUUID() }
const event = EventSchemas.parse({
  type: 'TEXT_MESSAGE_CONTENT',
  messageId: 'm',
  delta: 'x'.repeat(32),
})

measure(
  'event store append 5k',
  () => {
    const seeded = seedTask(database.raw)
    const store = createEventStore(database.db, deps)
    for (let seq = 1; seq <= 5000; seq += 1) {
      store.appendSessionEvent({ sessionId: seeded.sessionId!, seq, event, ts: seq })
    }
  },
  3,
)

database.raw.close()
