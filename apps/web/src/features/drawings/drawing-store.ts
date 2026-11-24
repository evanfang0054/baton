import { create } from 'zustand'

interface DrawingState {
  editing: Record<string, true>
  conflicts: Record<string, true>
  beginEditing(artifactId: string): void
  endEditing(artifactId: string): void
  markConflict(artifactId: string): void
  clearConflict(artifactId: string): void
}

export const useDrawingStore = create<DrawingState>((set) => ({
  editing: {},
  conflicts: {},
  beginEditing: (artifactId) =>
    set((state) => ({ editing: { ...state.editing, [artifactId]: true } })),
  endEditing: (artifactId) =>
    set((state) => {
      const editing = { ...state.editing }
      delete editing[artifactId]
      return { editing }
    }),
  markConflict: (artifactId) =>
    set((state) => ({ conflicts: { ...state.conflicts, [artifactId]: true } })),
  clearConflict: (artifactId) =>
    set((state) => {
      const conflicts = { ...state.conflicts }
      delete conflicts[artifactId]
      return { conflicts }
    }),
}))

export function isDrawingEditing(artifactId: string): boolean {
  return useDrawingStore.getState().editing[artifactId] === true
}
