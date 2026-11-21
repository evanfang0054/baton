import type { Node } from '@baton/protocol'
import { create } from 'zustand'

export type WsStatus = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'unauthorized'

export type SelectionNode = Pick<Node, 'id' | 'type'>

export type RightPanelMode = 'supervisor' | 'task' | 'node'

export type MobileTab = 'board' | 'supervisor' | 'digest'

const CONTEXT_TYPES = new Set<Node['type']>(['text', 'file', 'image', 'group'])

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

interface AppState {
  activeWorkspaceId: string | null
  activeTaskId: string | null
  selectedNodeId: string | null
  selectedNodeIds: string[]
  sceneTaskId: string | null
  contextNodeIds: string[]
  boardExpanded: boolean
  boardPinned: boolean
  rightPanel: RightPanelMode
  mobileTab: MobileTab
  wsStatus: WsStatus
  lastSeq: number
  setWorkspace: (id: string | null) => void
  setTask: (id: string | null) => void
  setSelectedNode: (id: string | null) => void
  setSelection: (nodes: SelectionNode[]) => void
  setSceneTask: (id: string | null) => void
  removeContextNode: (id: string) => void
  clearContext: () => void
  setBoardExpanded: (value: boolean) => void
  setBoardPinned: (value: boolean) => void
  setRightPanel: (value: RightPanelMode) => void
  setMobileTab: (value: MobileTab) => void
  setWsStatus: (value: WsStatus) => void
  setLastSeq: (value: number) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeWorkspaceId: null,
  activeTaskId: null,
  selectedNodeId: null,
  selectedNodeIds: [],
  sceneTaskId: null,
  contextNodeIds: [],
  boardExpanded: false,
  boardPinned: false,
  rightPanel: 'supervisor',
  mobileTab: 'board',
  wsStatus: 'offline',
  lastSeq: 0,
  setWorkspace: (activeWorkspaceId) =>
    set({
      activeWorkspaceId,
      activeTaskId: null,
      selectedNodeId: null,
      selectedNodeIds: [],
      sceneTaskId: null,
      contextNodeIds: [],
      rightPanel: 'supervisor',
      mobileTab: 'board',
    }),
  setTask: (activeTaskId) =>
    set((state) => ({
      activeTaskId,
      sceneTaskId: state.sceneTaskId === activeTaskId ? state.sceneTaskId : null,
    })),
  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  setSceneTask: (sceneTaskId) => set({ sceneTaskId }),
  setSelection: (nodes) =>
    set((state) => {
      const selectedNodeIds = nodes.map((node) => node.id)
      const contentIds = nodes.filter((node) => CONTEXT_TYPES.has(node.type)).map((node) => node.id)
      const contextNodeIds = contentIds.length > 0 ? contentIds : state.contextNodeIds
      if (
        sameIds(selectedNodeIds, state.selectedNodeIds) &&
        sameIds(contextNodeIds, state.contextNodeIds)
      ) {
        return state
      }
      return { selectedNodeIds, contextNodeIds }
    }),
  removeContextNode: (id) =>
    set((state) => ({ contextNodeIds: state.contextNodeIds.filter((item) => item !== id) })),
  clearContext: () => set({ contextNodeIds: [] }),
  setBoardExpanded: (boardExpanded) => set({ boardExpanded }),
  setBoardPinned: (boardPinned) => set({ boardPinned }),
  setRightPanel: (rightPanel) => set({ rightPanel }),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setLastSeq: (lastSeq) => set({ lastSeq }),
}))
