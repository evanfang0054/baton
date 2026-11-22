import { describe, expect, it } from 'vitest'
import { matchTemplate, TASK_TEMPLATES, templateById } from '../src/supervisor/templates.js'

describe('task templates', () => {
  it('ships four complete templates', () => {
    expect(TASK_TEMPLATES.map((template) => template.id)).toEqual([
      'bugfix',
      'feature',
      'review',
      'handoff',
    ])
    for (const template of TASK_TEMPLATES) {
      expect(template.label.length).toBeGreaterThan(0)
      expect(template.titlePattern).toContain('{goal}')
      expect(template.acceptanceSeed.length).toBeGreaterThanOrEqual(3)
      expect(template.acceptanceSeed.length).toBeLessThanOrEqual(5)
      expect(template.acceptanceSeed.every((seed) => seed.length <= 200)).toBe(true)
    }
  })

  it('matches intent without forcing a template', () => {
    expect(matchTemplate('修复登录页崩溃')).toBe('bugfix')
    expect(matchTemplate('审查这次改动')).toBe('review')
    expect(matchTemplate('把结果交接给 B')).toBe('handoff')
    expect(matchTemplate('做一个新功能')).toBe('feature')
    expect(matchTemplate('帮我看看')).toBeNull()
    expect(templateById('bugfix')?.titlePattern).toBe('修复：{goal}')
  })
})
