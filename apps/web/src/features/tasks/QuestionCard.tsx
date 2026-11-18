import { UserQuestionList, type Approval } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { useMemo, useState } from 'react'
import { useCommandAction } from './useCommandAction'

const questionFieldClass =
  'min-h-16 rounded-lg border border-separator bg-background px-2 py-1 text-sm text-foreground'

export function QuestionCard({
  approval,
  onDone,
}: {
  approval: Approval
  onDone: () => Promise<void> | void
}) {
  const action = useCommandAction(onDone)
  const questions = useMemo(() => {
    const input = approval.request.input
    const raw =
      typeof input === 'object' && input !== null
        ? (input as { questions?: unknown }).questions
        : undefined
    const parsed = UserQuestionList.safeParse(raw)
    return parsed.success ? parsed.data : null
  }, [approval.request.input])
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [response, setResponse] = useState('')

  const toggle = (question: string, label: string, multiSelect: boolean): void => {
    setSelected((previous) => {
      const current = previous[question] ?? []
      if (!multiSelect) {
        return { ...previous, [question]: [label] }
      }
      return {
        ...previous,
        [question]: current.includes(label)
          ? current.filter((value) => value !== label)
          : [...current, label],
      }
    })
  }

  if (!questions) {
    return (
      <section className="shrink-0 rounded-lg border border-danger border-l-2 bg-surface p-3">
        <h3 className="text-sm font-medium">无法解析 Agent 的提问</h3>
        <p className="mt-2 text-xs text-muted">
          提问数据不完整，无法呈现选项。拒绝后 Agent 会收到否定结果。
        </p>
        <div className="mt-3 flex justify-end">
          <Button
            variant="danger"
            isDisabled={action.pending}
            onPress={() =>
              action.run({
                type: 'approval.decide',
                payload: { approvalId: approval.id, decision: 'deny' },
              })
            }
          >
            拒绝
          </Button>
        </div>
        {action.error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {action.error}
          </p>
        ) : null}
      </section>
    )
  }

  const complete = questions.every((question) => (selected[question.question] ?? []).length > 0)

  const submit = (): void => {
    const answers: Record<string, string> = {}
    for (const question of questions) {
      answers[question.question] = (selected[question.question] ?? []).join(',')
    }
    action.run({
      type: 'approval.decide',
      payload: {
        approvalId: approval.id,
        decision: 'allow',
        answers,
        ...(response.trim() ? { response: response.trim() } : {}),
      },
    })
  }

  return (
    <section className="shrink-0 rounded-lg border border-warning border-l-2 bg-surface p-3">
      <h3 className="text-sm font-medium">Agent 需要你的选择</h3>
      {questions.map((question) => (
        <fieldset key={question.question} className="mt-3">
          <legend className="text-xs text-muted">{question.header}</legend>
          <p className="mt-1 text-sm text-foreground">{question.question}</p>
          <div className="mt-2 flex flex-col gap-1">
            {question.options.map((option) => {
              const checked = (selected[question.question] ?? []).includes(option.label)
              return (
                <label
                  key={option.label}
                  className={[
                    'flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5 text-xs',
                    checked ? 'border-accent bg-accent/10' : 'border-separator',
                  ].join(' ')}
                >
                  <input
                    type={question.multiSelect ? 'checkbox' : 'radio'}
                    name={question.question}
                    checked={checked}
                    onChange={() => toggle(question.question, option.label, question.multiSelect)}
                    className="mt-0.5 size-3.5 accent-accent"
                  />
                  <span>
                    <span className="block text-foreground">{option.label}</span>
                    <span className="text-muted">{option.description}</span>
                  </span>
                </label>
              )
            })}
          </div>
          {question.multiSelect ? <p className="mt-1 text-xs text-muted">可多选</p> : null}
        </fieldset>
      ))}
      <label className="mt-3 flex flex-col gap-1 text-xs text-muted">
        <span>补充说明（可选）</span>
        <textarea
          aria-label="补充说明"
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          className={questionFieldClass}
        />
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="danger"
          isDisabled={action.pending}
          onPress={() =>
            action.run({
              type: 'approval.decide',
              payload: { approvalId: approval.id, decision: 'deny' },
            })
          }
        >
          拒绝
        </Button>
        <Button variant="primary" isDisabled={action.pending || !complete} onPress={submit}>
          提交选择
        </Button>
      </div>
      {action.error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {action.error}
        </p>
      ) : null}
    </section>
  )
}
