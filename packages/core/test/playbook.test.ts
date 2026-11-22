import { describe, expect, it } from 'vitest'
import { nextStage, parsePlaybook, stageByKey, validatePlaybook } from '../src/playbook/index.js'

const standard = {
  id: 'standard-delivery',
  version: 1,
  label: '标准交付',
  stages: [
    {
      key: 'requirement',
      label: '需求',
      gate: 'human',
      produces: [{ kind: 'spec', name: 'spec.md', required: true }],
    },
    {
      key: 'design',
      label: '设计',
      gate: 'human',
      produces: [{ kind: 'prototype', name: 'prototype.html' }],
    },
    {
      key: 'build',
      label: '开发',
      gate: 'auto',
      produces: [{ kind: 'report', name: 'build-report.md' }],
    },
    {
      key: 'acceptance',
      label: '验收',
      gate: 'human',
      produces: [{ kind: 'report', name: 'acceptance.md' }],
    },
  ],
}

describe('playbook', () => {
  it('accepts the standard four stages', () => {
    const result = parsePlaybook(standard)
    expect(result.ok).toBe(true)
    if (result.ok) expect(nextStage(result.playbook, 'design')?.key).toBe('build')
  })

  it('rejects duplicate stage keys', () => {
    const result = parsePlaybook({
      ...standard,
      stages: [standard.stages[0], standard.stages[0]],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((issue) => issue.path === 'stages')).toBe(true)
  })

  it('requires the last stage to be human', () => {
    const result = parsePlaybook({
      ...standard,
      stages: standard.stages.map((stage, index) =>
        index === 3 ? { ...stage, gate: 'auto' } : stage,
      ),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects unsafe artifact names', () => {
    const result = parsePlaybook({
      ...standard,
      stages: [
        {
          key: 'a',
          label: 'A',
          gate: 'human',
          produces: [{ kind: 'other', name: '../x' }],
        },
        standard.stages[3],
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('navigates stages by key', () => {
    const result = parsePlaybook(standard)
    if (!result.ok) throw new Error('expected ok')
    expect(stageByKey(result.playbook, 'build')?.label).toBe('开发')
    expect(nextStage(result.playbook, 'acceptance')).toBeNull()
    expect(validatePlaybook(result.playbook)).toEqual([])
  })
})
