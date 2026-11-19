import type {
  SessionEventRecord,
  SessionEventsResponse,
  SupervisorMessagesResponse,
} from '@baton/protocol'
import { toast } from '@heroui/react/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { CommandProvider, offlineCommand, type CommandSender } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { createWsClient } from '../../lib/ws'
import { useAppStore } from '../../stores/app'
import { useSupervisorStreamStore } from '../supervisor/stream-store'
import { appendSessionEvents } from './session-cache'

const INVALIDATING_EVENTS = new Set(['task.status', 'approval.request', 'verify.result'])

export function RealtimeProvider({
  workspaceId,
  children,
}: {
  workspaceId: string | null
  children: ReactNode
}) {
  const queryClient = useQueryClient()
  const setWsStatus = useAppStore((state) => state.setWsStatus)
  const [send, setSend] = useState<CommandSender | null>(null)

  useEffect(() => {
    if (!workspaceId) {
      setWsStatus('offline')
      setSend(null)
      return
    }
    let invalidateTimer: number | undefined
    const invalidate = () => {
      if (invalidateTimer) return
      invalidateTimer = window.setTimeout(() => {
        invalidateTimer = undefined
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
        const taskId = useAppStore.getState().activeTaskId
        if (taskId) void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) })
      }, 100)
    }

    // 每个 chunk 都写缓存会触发 transcript 全量重投影；按帧合并写入。
    const pendingEvents = new Map<string, SessionEventRecord[]>()
    let flushTimer: number | undefined
    const finalizeTimers: number[] = []
    const flush = () => {
      flushTimer = undefined
      for (const [sessionId, records] of pendingEvents) {
        pendingEvents.delete(sessionId)
        const key = queryKeys.sessionEvents(sessionId)
        const cached = queryClient.getQueryData<SessionEventsResponse>(key)
        if (!cached) {
          // 首次历史还没回来：让 REST 重新拉取，避免丢掉这段实时事件。
          void queryClient.invalidateQueries({ queryKey: key })
          continue
        }
        queryClient.setQueryData<SessionEventsResponse>(key, (previous) =>
          appendSessionEvents(previous, records),
        )
      }
    }
    const enqueueEvent = (sessionId: string, record: SessionEventRecord) => {
      const list = pendingEvents.get(sessionId) ?? []
      list.push(record)
      pendingEvents.set(sessionId, list)
      if (!flushTimer) flushTimer = window.setTimeout(flush, 32)
    }

    const client = createWsClient({
      onStatus: (status) => {
        setWsStatus(status)
        if (status !== 'online') {
          // 断线后不会再有 delta/finish；清掉在途流式态，避免输入框永久 busy。
          useSupervisorStreamStore.getState().reset()
          return
        }
        // daemon 重启或首屏失败后，用一次重连把 REST 快照补齐。
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces })
        void queryClient.invalidateQueries({ queryKey: queryKeys.canvas(workspaceId) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.supervisorStatus })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.supervisorMessages(workspaceId),
        })
      },
      onEvent: (event) => {
        if (event.type === 'session.event') {
          const sessionId = event.payload.sessionId
          const inner = event.payload.event
          // task.status 可能因重连/订阅时序丢失；关键会话事件也触发一次任务刷新。
          if (
            (inner.type === 'CUSTOM' &&
              (inner.name === 'approval.request' || inner.name === 'session.outcome')) ||
            inner.type === 'RUN_STARTED' ||
            inner.type === 'RUN_FINISHED' ||
            inner.type === 'RUN_ERROR'
          ) {
            invalidate()
          }
          if (typeof event.payload.seq !== 'number') {
            // 旧 ws_event 行没有 session seq；回退到 REST 重新拉取。
            void queryClient.invalidateQueries({
              queryKey: queryKeys.sessionEvents(sessionId),
            })
            return
          }
          const record: SessionEventRecord = {
            seq: event.payload.seq,
            type: event.payload.event.type,
            payload: event.payload.event,
            ts: event.ts,
          }
          enqueueEvent(sessionId, record)
          return
        }
        if (event.type === 'supervisor.delta' || event.type === 'supervisor.tool') {
          useSupervisorStreamStore.getState().apply(event.payload)
          return
        }
        if (event.type === 'supervisor.message') {
          const finalize = () => {
            useSupervisorStreamStore.getState().finish()
            const key = queryKeys.supervisorMessages(workspaceId)
            queryClient.setQueryData<SupervisorMessagesResponse>(key, (previous) =>
              previous && !previous.messages.some((message) => message.id === event.payload.id)
                ? { ...previous, messages: [...previous.messages, event.payload] }
                : previous,
            )
            // 让 REST 校正 nextBefore / threadId 等分页字段。
            void queryClient.invalidateQueries({ queryKey: key })
            // create_task 不经过 task.status 事件；任务列表/看板必须在这里刷新。
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
            const taskId = event.payload.decision?.taskId
            if (taskId) {
              void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) })
            }
          }
          // 模型可能把一大段文本一次性吐出来；让流式气泡先按帧展示完，
          // 再切到最终消息，避免肉眼看到“整段闪现”。短回复几乎没有延迟。
          const streaming = useSupervisorStreamStore.getState().status === 'streaming'
          const delay = streaming
            ? Math.min(900, Math.max(120, Math.round(event.payload.content.length * 2)))
            : 0
          if (delay > 0) {
            finalizeTimers.push(window.setTimeout(finalize, delay))
          } else {
            finalize()
          }
          return
        }
        if (event.type === 'notice') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.notices(workspaceId) })
          if (event.payload.kind === 'digest') {
            toast.info('总管汇报已生成')
          }
          return
        }
        if (event.type === 'error') {
          toast.danger(event.payload.message)
          return
        }
        if (INVALIDATING_EVENTS.has(event.type)) invalidate()
      },
    })
    setSend(() => client.sendCommand)
    return () => {
      client.close()
      if (invalidateTimer) window.clearTimeout(invalidateTimer)
      if (flushTimer) window.clearTimeout(flushTimer)
      for (const timer of finalizeTimers) window.clearTimeout(timer)
    }
  }, [workspaceId, queryClient, setWsStatus])

  return <CommandProvider send={send ?? offlineCommand}>{children}</CommandProvider>
}
