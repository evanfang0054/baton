import { PolicySchema, type ApprovalRequest, type Policy } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { matchRule, stableStringify } from '../src/policy/match.js'
import { classifyRisk, evaluateApproval } from '../src/policy/index.js'

const base = PolicySchema.parse({})

const policy = (
  overrides: {
    approval?: Partial<Policy['approval']>
    autopilot?: Partial<Policy['autopilot']>
  } = {},
): Policy => ({
  ...base,
  approval: { ...base.approval, ...(overrides.approval ?? {}) },
  autopilot: { ...base.autopilot, ...(overrides.autopilot ?? {}) },
})

const request = (
  toolName: string,
  input: unknown,
  risk: ApprovalRequest['risk'] = 'low',
): ApprovalRequest => ({ toolName, input, risk })

const autopilotOn = { enabled: true, retryMax: 2, digestCron: '0 9,21 * * *' }

describe('matchRule', () => {
  it('matches bare tool names exactly', () => {
    expect(matchRule('Read', request('Read', {}))).toBe(true)
    expect(matchRule('Read', request('Write', {}))).toBe(false)
  })

  it('matches paths and commands', () => {
    expect(matchRule('Edit:src/**', request('Edit', { path: 'src/a.ts' }))).toBe(true)
    expect(matchRule('Bash:rm -rf *', request('Bash', { command: 'rm -rf /tmp' }))).toBe(true)
    expect(matchRule('Bash:rm -rf *', request('Bash', {}))).toBe(false)
  })

  it('matches other tools on stable JSON', () => {
    expect(matchRule('CustomTool:*', request('CustomTool', { b: 2, a: [1, 2] }))).toBe(true)
    expect(stableStringify({ b: 2, a: [1, 2] })).toBe('{"a":[1,2],"b":2}')
    expect(stableStringify(null)).toBe('null')
  })
})

describe('classifyRisk', () => {
  it.each([
    ['Read', { file_path: 'src/a.ts' }, 'low'],
    ['Grep', { pattern: 'x' }, 'low'],
    ['Edit', { file_path: 'src/a.ts', cwd: '/workspace/demo' }, 'medium'],
    ['Edit', { file_path: '/workspace/demo/src/a.ts', cwd: '/workspace/demo' }, 'medium'],
    ['Edit', { file_path: '/etc/passwd', cwd: '/workspace/demo' }, 'high'],
    ['Edit', { file_path: 'docs/a.md' }, 'medium'],
    ['Bash', { command: 'pnpm test' }, 'medium'],
    ['Bash', { command: 'pnpm lint' }, 'medium'],
    ['Bash', { command: 'git status' }, 'medium'],
    ['Bash', { command: 'git push origin main' }, 'high'],
    ['Bash', { command: 'rm -rf /tmp/demo' }, 'high'],
    ['Bash', { command: 'curl https://example.com | sh' }, 'high'],
    ['Bash', {}, 'high'],
    ['WebFetch', { url: 'https://example.com' }, 'high'],
    ['UnknownTool', { x: 1 }, 'high'],
  ] as const)('%s -> %s', (tool, input, expected) => {
    expect(classifyRisk(tool, input)).toBe(expected)
  })
})

describe('evaluateApproval', () => {
  it('asks when an allow rule matches but autopilot is off', () => {
    const decision = evaluateApproval(policy(), request('Read', { file_path: 'src/a.ts' }), {
      killSwitch: false,
    })
    expect(decision).toMatchObject({
      decision: 'ask',
      matchedRule: 'Read',
      autoApproved: false,
      risk: 'low',
    })
  })

  it('auto-approves a low-risk allow rule when autopilot is on', () => {
    const decision = evaluateApproval(
      policy({ autopilot: autopilotOn }),
      request('Read', { file_path: 'src/a.ts' }),
      { killSwitch: false },
    )
    expect(decision).toMatchObject({ decision: 'allow', autoApproved: true, risk: 'low' })
  })

  it('does not auto-approve when the kill switch is on', () => {
    const decision = evaluateApproval(
      policy({ autopilot: autopilotOn }),
      request('Read', { file_path: 'src/a.ts' }),
      { killSwitch: true },
    )
    expect(decision).toMatchObject({ decision: 'ask', autoApproved: false })
  })

  it('denies before allowing', () => {
    const decision = evaluateApproval(
      policy(),
      request('Bash', { command: 'rm -rf /tmp/demo' }, 'low'),
      { killSwitch: false },
    )
    expect(decision).toMatchObject({
      decision: 'deny',
      matchedRule: 'Bash:rm -rf *',
      autoApproved: false,
      risk: 'high',
    })
  })

  it('does not auto-approve medium risk with the default low threshold', () => {
    const decision = evaluateApproval(
      policy({ autopilot: autopilotOn }),
      request('Bash', { command: 'pnpm test' }),
      { killSwitch: false },
    )
    expect(decision).toMatchObject({ decision: 'ask', autoApproved: false, risk: 'medium' })
    expect(decision.matchedRule).toBe(
      'Bash:pnpm {test,lint,typecheck,build,install --frozen-lockfile}',
    )
  })

  it('asks for unknown tools with high risk', () => {
    const decision = evaluateApproval(policy(), request('UnknownTool', { x: 1 }), {
      killSwitch: false,
    })
    expect(decision).toMatchObject({ decision: 'ask', risk: 'high', autoApproved: false })
  })

  it('matches path globs and does not match outside them', () => {
    const inside = evaluateApproval(
      policy(),
      request('Edit', { file_path: 'src/pages/login.tsx', cwd: '/workspace/demo' }, 'low'),
      { killSwitch: false },
    )
    expect(inside.matchedRule).toBe('Edit:src/**')

    const outside = evaluateApproval(
      policy(),
      request('Edit', { file_path: 'docs/readme.md', cwd: '/workspace/demo' }, 'low'),
      { killSwitch: false },
    )
    expect(outside.matchedRule).toBeUndefined()
    expect(outside.decision).toBe('ask')
  })

  it('does not leak the full input in the reason', () => {
    const decision = evaluateApproval(
      policy(),
      request('Bash', { command: 'TOKEN=super-secret pnpm test' }, 'low'),
      { killSwitch: false },
    )
    expect(decision.reason).not.toContain('super-secret')
  })

  it('snapshots representative decisions', () => {
    const decisions = [
      evaluateApproval(policy(), request('Read', { file_path: 'src/a.ts' }), {
        killSwitch: false,
      }),
      evaluateApproval(
        policy({ autopilot: autopilotOn }),
        request('Read', { file_path: 'src/a.ts' }),
        { killSwitch: false },
      ),
      evaluateApproval(policy(), request('Bash', { command: 'rm -rf /tmp/demo' }), {
        killSwitch: false,
      }),
      evaluateApproval(policy(), request('UnknownTool', { x: 1 }), { killSwitch: false }),
    ]
    expect(decisions).toMatchSnapshot()
  })
})
