import type { Node } from '@baton/protocol'
import { create } from 'zustand'

export type WsStatus = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'unauthorized'

export type SelectionNode = Pick<Node, 'id' | 'type'>

const CONTEXT_TYPES = new Set<Node['type']>(['text', 'file', 'image', 'group'])

interface AppState {
  activeWorkspaceId: string | null
  activeTaskId: string | null
  selectedNodeId: string | null
  selectedNodeIds: string[]
  contextNodeIds: string[]
  boardExpanded: boolean
  boardPinned: boolean
  wsStatus: WsStatus
  lastSeq: number
  setWorkspace: (id: string | null) => void
  setTask: (id: string | null) => void
  setSelectedNode: (id: string | null) => void
  setSelection: (nodes: SelectionNode[]) => void
  removeContextNode: (id: string) => void
  clearContext: () => void
  setBoardExpanded: (value: boolean) => void
  setBoardPinned: (value: boolean) => void
  setWsStatus: (value: WsStatus) => void
  setLastSeq: (value: number) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeWorkspaceId: null,
  activeTaskId: null,
  selectedNodeId: null,
  selectedNodeIds: [],
  contextNodeIds: [],
  boardExpanded: false,
  boardPinned: false,
  wsStatus: 'offline',
  lastSeq: 0,
  setWorkspace: (activeWorkspaceId) =>
    set({
      activeWorkspaceId,
      activeTaskId: null,
      selectedNodeId: null,
      selectedNodeIds: [],
      contextNodeIds: [],
    }),
  setTask: (activeTaskId) => set({ activeTaskId }),
  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  setSelection: (nodes) =>
    set((state) => {
      const contentIds = nodes.filter((node) => CONTEXT_TYPES.has(node.type)).map((node) => node.id)
      return {
        selectedNodeIds: nodes.map((node) => node.id),
        ...(contentIds.length > 0 ? { contextNodeIds: contentIds } : {}),
      }
    }),
  removeContextNode: (id) =>
    set((state) => ({ contextNodeIds: state.contextNodeIds.filter((item) => item !== id) })),
  clearContext: () => set({ contextNodeIds: [] }),
  setBoardExpanded: (boardExpanded) => set({ boardExpanded }),
  setBoardPinned: (boardPinned) => set({ boardPinned }),
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setLastSeq: (lastSeq) => set({ lastSeq }),
}))
