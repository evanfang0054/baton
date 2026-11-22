import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  delete process.env.BATON_MIGRATIONS_DIR
})

function copyThrough(maxIdx: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-m14-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> }
  const entries = journal.entries.filter((entry) => entry.idx <= maxIdx)
  for (const entry of entries) {
    copyFileSync(join(migrationsDir, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
  }
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  return dir
}

describe('migration 0014', () => {
  it('moves structural fake engine rows and leaves append-only ledgers untouched', () => {
    const oldDir = copyThrough(13)
    const raw = openDb(':memory:')
    process.env.BATON_MIGRATIONS_DIR = oldDir
    migrateDb(raw)
    raw
      .prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)')
      .run('w1', 'demo', 'demo', 1)
    raw
      .prepare('insert into canvas (id, workspace_id, viewport_json) values (?, ?, ?)')
      .run('c1', 'w1', '{}')
    raw
      .prepare(
        `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
         values ('a1', 'c1', 'agent', 0, 0, 320, 200, null, ?, 1, 1)`,
      )
      .run(JSON.stringify({ title: '旧 Agent', engine: 'fake', taskId: null }))
    const textData = JSON.stringify({ content: '记录 "engine":"fake" 字面量' })
    raw
      .prepare(
        `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
         values ('t1', 'c1', 'text', 0, 0, 320, 200, null, ?, 1, 1)`,
      )
      .run(textData)
    raw
      .prepare(
        `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
         values ('bad', 'c1', 'agent', 0, 0, 320, 200, null, 'not-json', 1, 1)`,
      )
      .run()
    raw
      .prepare(
        `insert into task (id, workspace_id, title, prompt, status, engine, retry_count,
          dangerously_skip_permissions, created_at, updated_at)
         values ('task1','w1','t','p','todo','fake',0,0,1,111)`,
      )
      .run()
    raw
      .prepare(
        `insert into session (id, task_id, adapter, engine_session_id, status, started_at)
         values ('s1','task1','fake',null,'ended',1)`,
      )
      .run()
    raw
      .prepare(
        `insert into supervisor_thread (id, workspace_id, source, created_at, updated_at)
         values ('th1','w1','supervisor-chat',1,1)`,
      )
      .run()
    raw
      .prepare(
        `insert into supervisor_message (id, thread_id, role, content, tool_calls_json, status, created_at)
         values ('m1','th1','assistant','x',?,'ok',1)`,
      )
      .run(
        JSON.stringify([
          {
            id: 'c1',
            name: 'create_task',
            args: {},
            ok: true,
            result: { target: { engine: 'fake' } },
          },
        ]),
      )
    raw
      .prepare(
        `insert into supervisor_action (id, workspace_id, kind, status, strength, mode, reason,
          payload_json, result_json, policy_version, dedupe_key, created_at, updated_at, expires_at)
         values ('act1','w1','k','s','strong','auto','r',?,?,'v1','d1',1,1,2)`,
      )
      .run(
        JSON.stringify({ target: { engine: 'fake' } }),
        JSON.stringify({ engine: 'fake', note: 'fake news stays' }),
      )
    raw
      .prepare(
        `insert into supervisor_decision (id, thread_id, trigger_id, message_id, kind, strength,
          mode, reason, tool_calls_json, created_at)
         values ('dec1','th1','tr1','m1','k','strong','auto','r',?,1)`,
      )
      .run(JSON.stringify([{ name: 'create_task', args: { engine: 'fake' } }]))
    const eventPayload = JSON.stringify({
      sessionId: 's1',
      seq: 1,
      event: { type: 'CUSTOM', name: 'x', value: { engine: 'fake' } },
    })
    raw
      .prepare(
        `insert into event (id, session_id, ordinal, seq, type, payload_json, ts)
         values ('e1','s1',1,1,'CUSTOM',?,1)`,
      )
      .run(eventPayload)
    const wsPayload = JSON.stringify({ engine: 'fake' })
    raw
      .prepare(
        `insert into ws_event (id, type, payload_json, ts)
         values ('w1','x',?,1)`,
      )
      .run(wsPayload)
    const auditDetail = JSON.stringify({ engine: 'fake' })
    raw
      .prepare(
        `insert into audit (id, ts, actor, action, detail_json)
         values ('a1',1,'user','x',?)`,
      )
      .run(auditDetail)

    process.env.BATON_MIGRATIONS_DIR = migrationsDir
    migrateDb(raw)

    expect(raw.prepare("select engine, updated_at from task where id='task1'").get()).toEqual({
      engine: 'claude-sdk',
      updated_at: 111,
    })
    expect(raw.prepare("select adapter from session where id='s1'").get()).toEqual({
      adapter: 'claude-sdk',
    })
    expect(
      JSON.parse(
        (raw.prepare("select data_json from node where id='a1'").get() as { data_json: string })
          .data_json,
      ),
    ).toMatchObject({ engine: 'claude-sdk' })
    expect(
      (raw.prepare("select data_json from node where id='t1'").get() as { data_json: string })
        .data_json,
    ).toBe(textData)
    expect(
      JSON.parse(
        (
          raw.prepare("select tool_calls_json from supervisor_message where id='m1'").get() as {
            tool_calls_json: string
          }
        ).tool_calls_json,
      )[0].result.target.engine,
    ).toBe('claude-sdk')
    expect(
      (raw.prepare("select data_json from node where id='bad'").get() as { data_json: string })
        .data_json,
    ).toBe('not-json')
    const action = raw
      .prepare("select payload_json, result_json from supervisor_action where id='act1'")
      .get() as { payload_json: string; result_json: string }
    expect(JSON.parse(action.payload_json).target.engine).toBe('claude-sdk')
    expect(JSON.parse(action.result_json)).toEqual({
      engine: 'claude-sdk',
      note: 'fake news stays',
    })
    expect(
      JSON.parse(
        (
          raw.prepare("select tool_calls_json from supervisor_decision where id='dec1'").get() as {
            tool_calls_json: string
          }
        ).tool_calls_json,
      )[0].args.engine,
    ).toBe('claude-sdk')
    expect(
      (
        raw.prepare("select payload_json from event where id='e1'").get() as {
          payload_json: string
        }
      ).payload_json,
    ).toBe(eventPayload)
    expect(
      (
        raw.prepare("select payload_json from ws_event where id='w1'").get() as {
          payload_json: string
        }
      ).payload_json,
    ).toBe(wsPayload)
    expect(
      (
        raw.prepare("select detail_json from audit where id='a1'").get() as {
          detail_json: string
        }
      ).detail_json,
    ).toBe(auditDetail)
    raw.close()
  })
})
