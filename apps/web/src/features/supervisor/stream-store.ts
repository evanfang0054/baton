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
  begin: (input: { threadId: string; messageId: string }) => void
  append: (event: DeltaPayload) => void
  tool: (event: ToolPayload) => void
  apply: (event: DeltaPayload | ToolPayload) => void
  finish: () => void
  reset: () => void
}

export const useSupervisorStreamStore = create<SupervisorStreamStore>((set) => ({
  ...createStreamState(),
  begin: ({ threadId, messageId }) =>
    set({ threadId, messageId, text: '', tools: [], status: 'streaming' }),
  append: (event) => set((state) => applyDelta(state, event)),
  tool: (event) => set((state) => applyTool(state, event)),
  apply: (event) =>
    set((state) => ('delta' in event ? applyDelta(state, event) : applyTool(state, event))),
  finish: () => set(finishStream()),
  reset: () => set(createStreamState()),
}))

export const useSupervisorStream = useSupervisorStreamStore
