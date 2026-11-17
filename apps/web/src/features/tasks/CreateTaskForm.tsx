import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { TextArea } from '@heroui/react/textarea'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'

export function CreateTaskForm({
  nodeId,
  workspaceId,
  defaultTitle,
  onCreated,
}: {
  nodeId: string
  workspaceId: string
  defaultTitle: string
  onCreated: (taskId: string) => void
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(defaultTitle)
  const [prompt, setPrompt] = useState('')
  const [verifyCommand, setVerifyCommand] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!title.trim() || !prompt.trim() || pending) return
    setPending(true)
    setError(null)
    try {
      const result = (await send({
        type: 'task.create',
        payload: {
          workspaceId,
          nodeId,
          title: title.trim(),
          prompt: prompt.trim(),
          contextNodeIds: [],
          engine: 'fake',
          workspaceMode: 'main',
          ...(verifyCommand.trim() ? { verifyCommand: verifyCommand.trim() } : {}),
        },
      })) as { taskId?: string } | undefined
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
      if (result?.taskId) onCreated(result.taskId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务创建失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="rounded-lg border border-separator bg-background p-3">
      <h3 className="text-sm font-medium">创建任务</h3>
      <div className="mt-2 flex flex-col gap-2">
        <Input
          aria-label="任务标题"
          placeholder="任务标题"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          fullWidth
        />
        <TextArea
          aria-label="任务说明"
          placeholder="告诉 Agent 要做什么"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          fullWidth
        />
        <Input
          aria-label="验收命令"
          placeholder="验收命令（可选）"
          value={verifyCommand}
          onChange={(event) => setVerifyCommand(event.target.value)}
          fullWidth
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button
          variant="primary"
          isDisabled={!title.trim() || !prompt.trim() || pending}
          onPress={() => void submit()}
        >
          创建任务
        </Button>
      </div>
    </section>
  )
}
