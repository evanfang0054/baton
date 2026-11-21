import type { AcceptanceItemStatus } from '@baton/protocol'
import {
  ACCEPTANCE_STATUSES,
  MAX_AC_EVIDENCE,
  MAX_AC_ITEMS,
  MAX_AC_TEXT,
  MAX_AC_TOTAL_CHARS,
} from './constants.js'

export interface AcceptanceUpdateItemInput {
  id?: string
  text: string
  status: AcceptanceItemStatus
  evidence?: string | null
}

export type AcceptanceUpdateErrorCode =
  | 'revision_conflict'
  | 'too_many_items'
  | 'empty_text'
  | 'text_too_long'
  | 'evidence_too_long'
  | 'total_too_long'
  | 'invalid_status'

export type AcceptanceUpdateValidation =
  | { ok: true }
  | { ok: false; code: AcceptanceUpdateErrorCode; message: string; index?: number }

export function validateAcceptanceUpdate(input: {
  items: AcceptanceUpdateItemInput[]
  expectedRevision: number
  currentRevision: number
}): AcceptanceUpdateValidation {
  if (input.expectedRevision !== input.currentRevision) {
    return {
      ok: false,
      code: 'revision_conflict',
      message: '验收清单已被更新，请重新加载后再保存',
    }
  }
  if (input.items.length > MAX_AC_ITEMS) {
    return {
      ok: false,
      code: 'too_many_items',
      message: `验收条目最多 ${MAX_AC_ITEMS} 条`,
    }
  }

  let totalChars = 0
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index]!
    if (!(ACCEPTANCE_STATUSES as readonly string[]).includes(item.status)) {
      return { ok: false, code: 'invalid_status', message: '验收状态不合法', index }
    }
    if (item.text.length === 0) {
      return { ok: false, code: 'empty_text', message: '验收条目不能为空', index }
    }
    if (item.text.length > MAX_AC_TEXT) {
      return {
        ok: false,
        code: 'text_too_long',
        message: `单条验收最多 ${MAX_AC_TEXT} 字`,
        index,
      }
    }
    if ((item.evidence?.length ?? 0) > MAX_AC_EVIDENCE) {
      return {
        ok: false,
        code: 'evidence_too_long',
        message: `证据最多 ${MAX_AC_EVIDENCE} 字`,
        index,
      }
    }
    totalChars += item.text.length
  }

  if (totalChars > MAX_AC_TOTAL_CHARS) {
    return {
      ok: false,
      code: 'total_too_long',
      message: `验收清单总文本最多 ${MAX_AC_TOTAL_CHARS} 字`,
    }
  }
  return { ok: true }
}
