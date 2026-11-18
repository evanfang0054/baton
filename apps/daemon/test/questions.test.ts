import type { ApprovalRequest } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import {
  parseStoredAnswers,
  readQuestions,
  validateQuestionAnswers,
} from '../src/runtime/questions.js'

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    toolName: 'AskUserQuestion',
    risk: 'high',
    input: {
      questions: [
        {
          question: '用哪个方案？',
          header: '方案',
          multiSelect: false,
          options: [
            { label: '方案 A', description: '改动小' },
            { label: '方案 B', description: '重构彻底' },
          ],
        },
        {
          question: '需要哪些测试？',
          header: '测试',
          multiSelect: true,
          options: [
            { label: '单元测试', description: 'vitest' },
            { label: 'E2E', description: 'playwright' },
          ],
        },
      ],
    },
    ...overrides,
  }
}

describe('structured question answers', () => {
  it('ignores non-question approvals', () => {
    const tool = request({ toolName: 'Bash' })
    expect(readQuestions(tool)).toBeNull()
    expect(validateQuestionAnswers(tool, { decision: 'allow' })).toEqual({
      ok: true,
      payload: null,
    })
  })

  it('rejects malformed question payloads', () => {
    const result = validateQuestionAnswers(request({ input: {} }), { decision: 'allow' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_payload')
    }
  })

  it('requires one valid answer per question', () => {
    const missing = validateQuestionAnswers(request(), {
      decision: 'allow',
      answers: { '用哪个方案？': '方案 A' },
    })
    expect(missing.ok).toBe(false)

    const unknown = validateQuestionAnswers(request(), {
      decision: 'allow',
      answers: { '用哪个方案？': '方案 C', '需要哪些测试？': 'E2E' },
    })
    expect(unknown.ok).toBe(false)

    const multiSingle = validateQuestionAnswers(request(), {
      decision: 'allow',
      answers: { '用哪个方案？': '方案 A,方案 B', '需要哪些测试？': 'E2E' },
    })
    expect(multiSingle.ok).toBe(false)
  })

  it('normalizes multi-select answers and trims the optional response', () => {
    const result = validateQuestionAnswers(request(), {
      decision: 'allow',
      answers: {
        '用哪个方案？': '方案 B',
        '需要哪些测试？': ' 单元测试 , E2E ',
      },
      response: '  先做最小改动  ',
    })
    expect(result).toEqual({
      ok: true,
      payload: {
        answers: { '用哪个方案？': '方案 B', '需要哪些测试？': '单元测试,E2E' },
        response: '先做最小改动',
      },
    })
  })

  it('does not require answers when denied', () => {
    expect(validateQuestionAnswers(request(), { decision: 'deny' })).toEqual({
      ok: true,
      payload: null,
    })
  })

  it('parses stored answers defensively', () => {
    expect(parseStoredAnswers({ answers: { '用哪个方案？': '方案 A' }, response: '补充' })).toEqual(
      { answers: { '用哪个方案？': '方案 A' }, response: '补充' },
    )
    expect(parseStoredAnswers(null)).toBeNull()
    expect(parseStoredAnswers({ answers: {} })).toEqual({ answers: {} })
    expect(parseStoredAnswers({ answers: { q: 1 } })).toBeNull()
  })
})
