import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/index.js'

const dirs: string[] = []

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe('sqlite pragmas', () => {
  it('uses WAL and NORMAL synchronous mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-db-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'test.db'))
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('synchronous', { simple: true })).toBe(1)
    db.close()
  })
})
