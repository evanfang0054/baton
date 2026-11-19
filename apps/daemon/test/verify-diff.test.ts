import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import { captureDiff } from '../src/verify/diff.js'

const dirs: string[] = []

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'baton-diff-'))
  dirs.push(dir)
  await execa('git', ['-C', dir, 'init', '-q'])
  await execa('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
  await execa('git', ['-C', dir, 'config', 'user.name', 'test'])
  return dir
}

async function commitAll(repo: string): Promise<void> {
  await execa('git', ['-C', repo, 'add', '-A'])
  await execa('git', ['-C', repo, 'commit', '-qm', 'fixture'])
}

describe('captureDiff', () => {
  it('captures modified, untracked and deleted files', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'hello\n')
    writeFileSync(join(repo, 'b.txt'), 'bye\n')
    await commitAll(repo)

    writeFileSync(join(repo, 'a.txt'), 'hello world\n')
    writeFileSync(join(repo, 'new.txt'), 'new\n')
    rmSync(join(repo, 'b.txt'))

    const snapshot = await captureDiff(repo, () => 1)
    const byPath = new Map(snapshot.files.map((file) => [file.path, file]))
    expect(byPath.get('a.txt')?.status).toBe('modified')
    expect(byPath.get('a.txt')?.patch).toContain('+hello world')
    expect(byPath.get('new.txt')?.status).toBe('added')
    expect(byPath.get('b.txt')?.status).toBe('deleted')
    expect(snapshot.truncated).toBe(false)
  })

  it('marks binary files without a patch', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
    await commitAll(repo)
    writeFileSync(join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 4]))

    const snapshot = await captureDiff(repo, () => 1)
    const binary = snapshot.files.find((file) => file.path === 'bin.dat')
    expect(binary?.status).toBe('binary')
    expect(binary?.patch).toBe('')
  })

  it('captures renames with oldPath', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
    await commitAll(repo)
    await execa('git', ['-C', repo, 'mv', 'a.txt', 'b.txt'])

    const snapshot = await captureDiff(repo, () => 1)
    const renamed = snapshot.files.find((file) => file.path === 'b.txt')
    expect(renamed?.status).toBe('renamed')
    expect(renamed?.oldPath).toBe('a.txt')
    expect(renamed?.patch).toContain('rename from a.txt')
  })

  it('truncates a single large patch', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'big.txt'), 'a'.repeat(200 * 1024))
    await commitAll(repo)
    writeFileSync(join(repo, 'big.txt'), 'b'.repeat(200 * 1024))

    const snapshot = await captureDiff(repo, () => 1)
    expect(snapshot.truncated).toBe(true)
    const big = snapshot.files.find((file) => file.path === 'big.txt')
    expect(Buffer.byteLength(big?.patch ?? '', 'utf8')).toBeLessThanOrEqual(128 * 1024)
  })

  it('truncates the total patch budget', async () => {
    const repo = await makeRepo()
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(repo, `f${index}.txt`), 'a'.repeat(120 * 1024))
    }
    await commitAll(repo)
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(repo, `f${index}.txt`), 'b'.repeat(120 * 1024))
    }

    const snapshot = await captureDiff(repo, () => 1)
    expect(snapshot.truncated).toBe(true)
    const total = snapshot.files.reduce(
      (sum, file) => sum + Buffer.byteLength(file.patch, 'utf8'),
      0,
    )
    expect(total).toBeLessThanOrEqual(512 * 1024)
  })

  it('returns an empty snapshot for non-git and clean workspaces', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'baton-diff-plain-'))
    dirs.push(plain)
    expect((await captureDiff(plain, () => 1)).files).toEqual([])

    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'hello\n')
    await commitAll(repo)
    expect((await captureDiff(repo, () => 1)).files).toEqual([])
  })
})
