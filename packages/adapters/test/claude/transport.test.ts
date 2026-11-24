import { describe, expect, it } from 'vitest'
import { claudeSdkMeta } from '../../src/claude/meta.js'
import {
  buildClaudeOptions,
  approvalInputWithCwd,
  createBatonReportHandler,
  DISALLOWED_TOOLS,
} from '../../src/claude/transport.js'

const base = {
  prompt: 'demo',
  cwd: '/workspace/demo',
  projectHooksGlobal: true,
  bypassPermissions: false,
  systemPromptAppend: '<baton_protocol/>',
  maxTurns: 30,
}

describe('createBatonReportHandler', () => {
  it('reports once per turn and resets for the next send', () => {
    const emitted: Array<{ outcome: string; reason?: string }> = []
    const handler = createBatonReportHandler((outcome, reason) =>
      emitted.push({ outcome, ...(reason ? { reason } : {}) }),
    )
    expect(handler.report({ outcome: 'blocked', reason: 'need input' })).toEqual({
      content: [{ type: 'text', text: 'reported' }],
    })
    handler.report({ outcome: 'ready' })
    expect(emitted).toEqual([{ outcome: 'blocked', reason: 'need input' }])

    handler.reset()
    handler.report({ outcome: 'ready' })
    expect(emitted).toEqual([{ outcome: 'blocked', reason: 'need input' }, { outcome: 'ready' }])
  })
})

describe('buildClaudeOptions', () => {
  it('isolates an untrusted workspace and disables hooks', () => {
    const options = buildClaudeOptions({
      ...base,
      workspaceTrust: { projectSettings: false, projectHooks: false },
    })
    expect(options.settingSources).toEqual(['user'])
    expect(options.strictMcpConfig).toBe(true)
    expect(options.plugins).toEqual([])
    expect(options.managedSettings).toMatchObject({
      allowManagedPermissionRulesOnly: true,
      disableAllHooks: true,
      permissions: {
        disableBypassPermissionsMode: 'disable',
        blockReadsOutsideWorkingDirectories: true,
        blockWritesOutsideWorkingDirectories: true,
      },
    })
  })

  it('loads project settings only after trust', () => {
    const options = buildClaudeOptions({
      ...base,
      workspaceTrust: { projectSettings: true, projectHooks: true },
    })
    expect(options.settingSources).toEqual(['user', 'project'])
    expect(options.strictMcpConfig).toBe(false)
    expect(options.managedSettings?.disableAllHooks).toBeUndefined()
    expect(options.managedSettings?.allowManagedPermissionRulesOnly).toBe(true)
  })

  it('lets the global switch force hooks off', () => {
    const options = buildClaudeOptions({
      ...base,
      projectHooksGlobal: false,
      workspaceTrust: { projectSettings: true, projectHooks: true },
    })
    expect(options.managedSettings?.disableAllHooks).toBe(true)
  })

  it('locks the permission and tool surface', () => {
    const options = buildClaudeOptions({
      ...base,
      workspaceTrust: { projectSettings: false, projectHooks: false },
    })
    expect(options.permissionMode).toBe('default')
    expect(options.allowDangerouslySkipPermissions).toBe(false)
    expect(options.includePartialMessages).toBe(false)
    expect(options.maxTurns).toBe(30)
    expect(options.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' })
    expect(options.disallowedTools).toEqual(expect.arrayContaining([...DISALLOWED_TOOLS]))
    expect(options.env?.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('baton/0.0.0')
  })

  it('enables bypass only when explicitly requested', () => {
    const options = buildClaudeOptions({
      ...base,
      bypassPermissions: true,
      workspaceTrust: { projectSettings: true, projectHooks: false },
    })
    expect(options.permissionMode).toBe('bypassPermissions')
    expect(options.allowDangerouslySkipPermissions).toBe(true)
    // managed settings 里的 disableBypassPermissionsMode 会让 SDK 直接拒绝 bypass。
    expect(options.managedSettings?.permissions?.disableBypassPermissionsMode).toBeUndefined()
  })

  it('reports the installed SDK version without importing the SDK', () => {
    expect(claudeSdkMeta()).toEqual({ available: true, version: '0.3.327' })
  })

  it('adds workspace cwd to file tool approvals without touching other tools', () => {
    expect(
      approvalInputWithCwd('Edit', { file_path: '/workspace/demo/src/a.ts' }, '/workspace/demo'),
    ).toEqual({ file_path: '/workspace/demo/src/a.ts', cwd: '/workspace/demo' })
    expect(
      approvalInputWithCwd(
        'Edit',
        { file_path: 'src/a.ts', cwd: '/from-engine' },
        '/workspace/demo',
      ),
    ).toEqual({ file_path: 'src/a.ts', cwd: '/workspace/demo' })
    expect(approvalInputWithCwd('Bash', { command: 'ls' }, '/workspace/demo')).toEqual({
      command: 'ls',
    })
  })
})
