import type { AcceptanceContract, AcceptanceItem, AcceptanceItemStatus } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useEffect, useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { CommandError } from '../../lib/ws'

const MAX_ITEMS = 8
const MAX_TEXT = 200
const MAX_TOTAL = 2000

const STATUS_LABELS: Record<AcceptanceItemStatus, string> = {
  pending: '待验',
  pass: '通过',
  fail: '未过',
  waived: '豁免',
}

interface DraftItem {
  id?: string
  text: string
  status: AcceptanceItemStatus
  evidence: string
}

function toDraft(items: AcceptanceItem[]): DraftItem[] {
  return items.map((item) => ({
    id: item.id,
    text: item.text,
    status: item.status,
    evidence: item.evidence ?? '',
  }))
}

export function AcceptanceEditor({
  taskId,
  contract,
  items,
  disabled = false,
  onSaved,
}: {
  taskId: string
  contract: AcceptanceContract
  items: AcceptanceItem[]
  disabled?: boolean
  onSaved: () => Promise<void> | void
}) {
  const send = useCommand()
  const [draft, setDraft] = useState<DraftItem[]>(() => toDraft(items))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const readOnly = disabled || contract.status !== 'draft'

  useEffect(() => {
    setDraft(toDraft(items))
    setError(null)
    setSaved(false)
  }, [contract.id, contract.revision, items])

  const totalChars = draft.reduce((sum, item) => sum + item.text.length + item.evidence.length, 0)
  const overLimit =
    draft.length > MAX_ITEMS ||
    totalChars > MAX_TOTAL ||
    draft.some((item) => item.text.trim().length === 0 || item.text.length > MAX_TEXT) ||
    draft.some((item) => item.evidence.length > MAX_TEXT)

  const update = (index: number, patch: Partial<DraftItem>) => {
    setSaved(false)
    setDraft((previous) =>
      previous.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    )
  }

  const add = () => {
    if (draft.length >= MAX_ITEMS) return
    setSaved(false)
    setDraft((previous) => [...previous, { text: '', status: 'pending', evidence: '' }])
  }

  const remove = (index: number) => {
    setSaved(false)
    setDraft((previous) => previous.filter((_, itemIndex) => itemIndex !== index))
  }

  const waive = (index: number) => {
    update(index, { status: 'waived' })
  }

  const save = async () => {
    if (readOnly || overLimit || pending) return
    setPending(true)
    setError(null)
    try {
      await send({
        type: 'acceptance.update',
        payload: {
          taskId,
          contractId: contract.id,
          expectedRevision: contract.revision,
          items: draft.map((item) => ({
            ...(item.id ? { id: item.id } : {}),
            text: item.text.trim(),
            status: item.status,
            evidence: item.evidence.trim() ? item.evidence.trim() : null,
          })),
        },
      })
      await onSaved()
      setSaved(true)
      toast.success('验收清单已保存')
    } catch (cause) {
      if (cause instanceof CommandError && cause.code === 'revision_conflict') {
        setError('清单已被更新，请重载')
        await onSaved()
      } else {
        setError(cause instanceof Error ? cause.message : '保存失败')
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="shrink-0 rounded-lg border border-separator bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">验收清单</h3>
        <span className="text-xs text-muted">
          {saved ? <span className="mr-2 text-success">已保存</span> : null}
          {draft.length}/{MAX_ITEMS} 条 · {totalChars}/{MAX_TOTAL} 字
        </span>
      </div>
      {readOnly ? (
        <p className="mt-1 text-xs text-muted">验收清单当前为只读，不能再修改。</p>
      ) : null}
      <ul className="mt-2 flex flex-col gap-2">
        {draft.map((item, index) => (
          <li key={item.id ?? `new-${index}`} className="rounded border border-separator p-2">
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-xs text-muted">{index + 1}</span>
              <select
                aria-label={`第 ${index + 1} 条状态`}
                className="h-8 rounded-lg border border-separator bg-background px-2 text-xs"
                value={item.status}
                disabled={readOnly}
                onChange={(event) =>
                  update(index, { status: event.target.value as AcceptanceItemStatus })
                }
              >
                {(Object.keys(STATUS_LABELS) as AcceptanceItemStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
              <input
                aria-label={`验收条目 ${index + 1}`}
                className="h-8 min-w-0 flex-1 rounded-lg border border-separator bg-field px-2 text-xs text-foreground"
                value={item.text}
                maxLength={MAX_TEXT}
                disabled={readOnly}
                autoFocus={!item.id}
                placeholder="可验证的验收条件"
                onChange={(event) => update(index, { text: event.target.value })}
              />
            </div>
            <div className="mt-2 flex items-center gap-2 pl-8">
              <input
                aria-label={`第 ${index + 1} 条证据`}
                className="h-8 min-w-0 flex-1 rounded-lg border border-separator bg-field px-2 text-xs text-foreground"
                value={item.evidence}
                maxLength={MAX_TEXT}
                disabled={readOnly}
                placeholder="证据：文件:行 / 测试 / 命令输出"
                onChange={(event) => update(index, { evidence: event.target.value })}
              />
              <Button
                size="sm"
                variant="tertiary"
                isDisabled={readOnly}
                onPress={() => waive(index)}
              >
                豁免第 {index + 1} 条
              </Button>
              <Button size="sm" variant="ghost" isDisabled={readOnly} onPress={() => remove(index)}>
                删除第 {index + 1} 条
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {overLimit ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          验收条目最多 {MAX_ITEMS} 条，单条不超过 {MAX_TEXT} 字，总文本不超过 {MAX_TOTAL} 字。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          size="sm"
          variant="tertiary"
          isDisabled={readOnly || draft.length >= MAX_ITEMS}
          onPress={add}
        >
          添加条目
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          isDisabled={readOnly || pending}
          onPress={() => {
            setDraft(toDraft(items))
            setError(null)
            setSaved(false)
          }}
        >
          重置
        </Button>
        <Button
          size="sm"
          variant="primary"
          isDisabled={readOnly || overLimit || pending}
          onPress={() => void save()}
        >
          {pending ? '保存中…' : '保存验收清单'}
        </Button>
      </div>
    </section>
  )
}
