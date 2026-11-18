import type { SupervisorDeltaEvent, SupervisorToolEvent } from '@baton/protocol'
import { create } from 'zustand'
import {
  applyDelta,
  applyTool,
  createStreamState,
  finishStream,
  type SupervisorStreamProjection,
} from './supervisor-model'

type DeltaPayload = SupervisorDeltaEvent['payload']
type ToolPayload = SupervisorToolEvent['payload']

interface SupervisorStreamStore extends SupervisorStreamProjection {
  waitForReply: () => void
  apply: (event: DeltaPayload | ToolPayload) => void
  finish: () => void
  reset: () => void
}

export const useSupervisorStreamStore = create<SupervisorStreamStore>((set) => ({
  ...createStreamState(),
  // 发送成功后、第一个 delta 到达前，也要让 UI 显示“正在思考”，而不是空白等待。
  waitForReply: () =>
    set((state) =>
      state.status === 'idle'
        ? { ...state, status: 'streaming', text: '', tools: [], messageId: null, threadId: null }
        : state,
    ),
  apply: (event) =>
    set((state) => ('delta' in event ? applyDelta(state, event) : applyTool(state, event))),
  finish: () => set(finishStream()),
  reset: () => set(createStreamState()),
}))

export const useSupervisorStream = useSupervisorStreamStore
