import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

export function Overlay({
  title,
  children,
  onClose,
  width = 'min(880px, 92vw)',
  closeOnEscape = true,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  width?: string
  closeOnEscape?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const closeOnEscapeRef = useRef(closeOnEscape)
  onCloseRef.current = onClose
  closeOnEscapeRef.current = closeOnEscape

  // 只在挂载时抢焦点；编辑器自动保存会反复重渲染，不能每次都把焦点从画布抢走。
  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (closeOnEscapeRef.current) onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      returnFocusRef.current?.focus()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[6vh]">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ width }}
        className="flex max-h-[88vh] flex-col overflow-hidden rounded-xl border border-separator bg-background shadow-overlay focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-separator px-4 py-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-default hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
