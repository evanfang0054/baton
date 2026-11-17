import { Button } from '@heroui/react/button'
import { TextArea } from '@heroui/react/textarea'
import { useState } from 'react'
import { useCommandAction } from './useCommandAction'

export function ReplyComposer({
  taskId,
  onDone,
}: {
  taskId: string
  onDone: () => Promise<void> | void
}) {
  const [text, setText] = useState('')
  const action = useCommandAction(async () => {
    setText('')
    await onDone()
  })

  const send = () => {
    const value = text.trim()
    if (!value || action.pending) return
    void action.run({ type: 'session.reply', payload: { taskId, text: value } })
  }

  return (
    <section className="shrink-0 rounded-lg border border-separator bg-background p-3">
      <TextArea
        aria-label="回复内容"
        placeholder="回复 Agent…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            send()
          }
        }}
        fullWidth
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">⌘/Ctrl + Enter 发送</span>
        <Button variant="primary" isDisabled={!text.trim() || action.pending} onPress={send}>
          发送
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
