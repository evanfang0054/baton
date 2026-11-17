import { create } from 'zustand'

export type WsStatus = 'connecting' | 'online' | 'reconnecting' | 'offline'

interface AppState {
  activeWorkspaceId: string | null
  activeTaskId: string | null
  boardExpanded: boolean
  boardPinned: boolean
  wsStatus: WsStatus
  lastSeq: number
  setWorkspace: (id: string | null) => void
  setTask: (id: string | null) => void
  setBoardExpanded: (value: boolean) => void
  setBoardPinned: (value: boolean) => void
  setWsStatus: (value: WsStatus) => void
  setLastSeq: (value: number) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeWorkspaceId: null,
  activeTaskId: null,
  boardExpanded: false,
  boardPinned: false,
  wsStatus: 'offline',
  lastSeq: 0,
  setWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId, activeTaskId: null }),
  setTask: (activeTaskId) => set({ activeTaskId }),
  setBoardExpanded: (boardExpanded) => set({ boardExpanded }),
  setBoardPinned: (boardPinned) => set({ boardPinned }),
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setLastSeq: (lastSeq) => set({ lastSeq }),
}))
