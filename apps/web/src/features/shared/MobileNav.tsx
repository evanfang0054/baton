import { Clock, LayoutList, MessageSquare } from 'lucide-react'
import type { MobileTab } from '../../stores/app'

const TABS: Array<{ id: MobileTab; label: string; icon: typeof LayoutList }> = [
  { id: 'board', label: '看板', icon: LayoutList },
  { id: 'supervisor', label: '总管', icon: MessageSquare },
  { id: 'digest', label: '汇报', icon: Clock },
]

const tabClass = [
  'relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-xs',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
].join(' ')

export function MobileNav({
  tab,
  onChange,
  attentionCount,
  unread,
}: {
  tab: MobileTab
  onChange: (tab: MobileTab) => void
  attentionCount: number
  unread: boolean
}) {
  return (
    <nav
      aria-label="移动端导航"
      className="fixed inset-x-0 bottom-0 z-30 flex min-h-16 items-stretch border-t border-separator bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const current = tab === id
        return (
          <button
            key={id}
            type="button"
            aria-current={current ? 'page' : undefined}
            onClick={() => onChange(id)}
            className={`${tabClass} ${current ? 'text-accent' : 'text-muted'}`}
          >
            <span className="relative">
              <Icon size={20} aria-hidden="true" />
              {id === 'board' && attentionCount > 0 ? (
                <span className="absolute -right-3 -top-2 rounded-full bg-danger px-1 text-[10px] leading-4 text-danger-foreground">
                  {attentionCount > 9 ? '9+' : attentionCount}
                </span>
              ) : null}
              {id === 'digest' && unread ? (
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent">
                  <span className="sr-only">有未读汇报</span>
                </span>
              ) : null}
            </span>
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
