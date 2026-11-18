import {
  UserQuestionList,
  type ApprovalDecision,
  type ApprovalRequest,
  type UserQuestionList as UserQuestionListValue,
} from '@baton/protocol'
import { appError } from '../errors.js'
import type { AppError } from '@baton/protocol'

/** Claude Code 的结构化提问工具名；答案会被写回 canUseTool 的 updatedInput。 */
export const ASK_USER_QUESTION_TOOL = 'AskUserQuestion'

export interface QuestionAnswerPayload {
  answers: Record<string, string>
  response?: string
}

export type QuestionAnswerCheck =
  { ok: true; payload: QuestionAnswerPayload | null } | { ok: false; error: AppError }

export function readQuestions(request: ApprovalRequest): UserQuestionListValue | null {
  if (request.toolName !== ASK_USER_QUESTION_TOOL) {
    return null
  }
  if (typeof request.input !== 'object' || request.input === null) {
    return null
  }
  const parsed = UserQuestionList.safeParse((request.input as { questions?: unknown }).questions)
  return parsed.success ? parsed.data : null
}

/**
 * 校验并规范化 AskUserQuestion 的答案。
 * 普通工具审批直接放行；提问必须每个问题都有合法选项，否则 SDK 会收到无答案的 allow。
 */
export function validateQuestionAnswers(
  request: ApprovalRequest,
  input: {
    decision: ApprovalDecision
    answers?: Record<string, string>
    response?: string
  },
): QuestionAnswerCheck {
  if (request.toolName !== ASK_USER_QUESTION_TOOL) {
    return { ok: true, payload: null }
  }
  const questions = readQuestions(request)
  if (!questions) {
    return { ok: false, error: appError('invalid_payload', 'AskUserQuestion payload is invalid') }
  }
  if (input.decision === 'deny') {
    return { ok: true, payload: null }
  }

  const answers = input.answers ?? {}
  const normalized: Record<string, string> = {}
  for (const question of questions) {
    const raw = answers[question.question]
    if (typeof raw !== 'string' || raw.trim() === '') {
      return {
        ok: false,
        error: appError('invalid_payload', 'every question requires an answer', {
          question: question.question,
        }),
      }
    }
    const labels = raw
      .split(',')
      .map((label) => label.trim())
      .filter((label) => label.length > 0)
    if (labels.length === 0) {
      return {
        ok: false,
        error: appError('invalid_payload', 'answer must not be empty', {
          question: question.question,
        }),
      }
    }
    if (!question.multiSelect && labels.length !== 1) {
      return {
        ok: false,
        error: appError('invalid_payload', 'single-select question accepts one option', {
          question: question.question,
        }),
      }
    }
    const allowed = new Set(question.options.map((option) => option.label))
    const unknown = labels.find((label) => !allowed.has(label))
    if (unknown !== undefined) {
      return {
        ok: false,
        error: appError('invalid_payload', 'answer is not one of the options', {
          question: question.question,
          label: unknown,
        }),
      }
    }
    normalized[question.question] = labels.join(',')
  }

  const response = input.response?.trim()
  return {
    ok: true,
    payload: { answers: normalized, ...(response ? { response } : {}) },
  }
}

/** 从 approval.responseJson 还原答案；格式不对时返回 null，由调用方回退为 deny。 */
export function parseStoredAnswers(value: unknown): QuestionAnswerPayload | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as { answers?: unknown; response?: unknown }
  if (
    typeof record.answers !== 'object' ||
    record.answers === null ||
    Array.isArray(record.answers)
  ) {
    return null
  }
  const answers: Record<string, string> = {}
  for (const [key, raw] of Object.entries(record.answers)) {
    if (typeof raw !== 'string') {
      return null
    }
    answers[key] = raw
  }
  return {
    answers,
    ...(typeof record.response === 'string' ? { response: record.response } : {}),
  }
}
