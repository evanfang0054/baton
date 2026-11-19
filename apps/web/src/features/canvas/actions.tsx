import { createContext, useContext, type ReactNode } from 'react'

export interface CanvasActions {
  updatePosition: (id: string, x: number, y: number) => void
  updateSize: (id: string, w: number, h: number) => void
  updateContent: (id: string, content: string) => void
}

const noop = () => {}

const CanvasActionsContext = createContext<CanvasActions>({
  updatePosition: noop,
  updateSize: noop,
  updateContent: noop,
})

export function CanvasActionsProvider({
  actions,
  children,
}: {
  actions: CanvasActions
  children: ReactNode
}) {
  return <CanvasActionsContext.Provider value={actions}>{children}</CanvasActionsContext.Provider>
}

export function useCanvasActions() {
  return useContext(CanvasActionsContext)
}
