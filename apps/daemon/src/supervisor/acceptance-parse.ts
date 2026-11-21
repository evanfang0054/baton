import { AcceptanceVerdict } from '@baton/protocol'
import type { AcceptanceVerdict as Verdict } from '@baton/protocol'

export interface ParsedAcceptanceItem {
  text: string
  status: 'pass' | 'fail' | 'pending'
  evidence: string | null
}

export interface ParsedAcceptanceReport {
  verdict: Verdict
  summary: string
  items: ParsedAcceptanceItem[]
}

const ITEM_STATUSES = new Set(['pass', 'fail', 'pending'])
const MAX_ITEMS = 8
const MAX_TEXT = 200
const MAX_EVIDENCE = 200
const MAX_SUMMARY = 1000

export function parseAcceptanceReport(text: string): ParsedAcceptanceReport | null {
  const tagged = lastMatch(text, /<acceptance_report>([\s\S]*?)<\/acceptance_report>/g)
  const fenced = lastMatch(text, /```json\s*([\s\S]*?)```/g)
  const raw = tagged ?? fenced
  if (!raw) return null

  let value: unknown
  try {
    value = JSON.parse(raw.trim())
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const verdict = AcceptanceVerdict.safeParse(record.verdict)
  if (!verdict.success) return null

  const summary =
    typeof record.summary === 'string' ? record.summary.trim().slice(0, MAX_SUMMARY) : ''
  const items: ParsedAcceptanceItem[] = []
  if (Array.isArray(record.items)) {
    for (const candidate of record.items.slice(0, MAX_ITEMS)) {
      if (!candidate || typeof candidate !== 'object') continue
      const item = candidate as Record<string, unknown>
      if (typeof item.text !== 'string' || typeof item.status !== 'string') continue
      if (!ITEM_STATUSES.has(item.status)) continue
      const text = item.text.trim().slice(0, MAX_TEXT)
      if (!text) continue
      const evidence =
        typeof item.evidence === 'string' && item.evidence.trim()
          ? item.evidence.trim().slice(0, MAX_EVIDENCE)
          : null
      items.push({
        text,
        status: item.status as ParsedAcceptanceItem['status'],
        evidence,
      })
    }
  }

  return { verdict: verdict.data, summary, items }
}

function lastMatch(text: string, pattern: RegExp): string | null {
  let match: RegExpExecArray | null
  let last: string | null = null
  while ((match = pattern.exec(text)) !== null) {
    last = match[1] ?? null
  }
  return last
}
