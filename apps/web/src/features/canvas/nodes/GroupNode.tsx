import { ChevronDown, ChevronRight, CircleCheck, FolderOpen } from 'lucide-react'
import { STAGE_STATUS_LABELS, formatWaiting } from '../../deliveries/delivery-labels'
import { useCanvasActions } from '../actions'
import type { CanvasFlowNodeProps } from './NodeShell'

export function GroupNode({ data, selected }: CanvasFlowNodeProps) {
  const group = data.node.type === 'group' ? data.node.data : null
  const actions = useCanvasActions()
  if (!group) return null
  const stage = data.stage ?? null
  const label = stage ? `${stage.ordinal} ${stage.label}` : group.label

  return (
    <div
      className={`flex h-full w-full flex-col rounded-xl border-2 border-dashed bg-surface/40 p-2 ${
        selected ? 'border-accent' : 'border-separator'
      } ${data.dimmed ? 'pointer-events-none opacity-25' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <FolderOpen size={14} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{label}</span>
        {stage ? (
          <>
            <span className="shrink-0 rounded bg-default px-1.5 py-0.5 text-[10px] text-foreground">
              {STAGE_STATUS_LABELS[stage.status]}
            </span>
            <span className="shrink-0 text-[10px] text-muted">
              {stage.artifactCount} 产物 · {stage.openAnnotationCount} 标注
            </span>
            {stage.skillId ? (
              <span
                title={
                  stage.skillStatus === 'ok'
                    ? `已加载 .baton/skills/${stage.skillId}/SKILL.md`
                    : stage.skillStatus === 'missing'
                      ? `未找到 .baton/skills/${stage.skillId}/SKILL.md；阶段仍会执行，但没有技能指引`
                      : '项目未信任，技能不会注入阶段 prompt'
                }
                className={`shrink-0 text-[10px] ${
                  stage.skillStatus === 'ok'
                    ? 'text-success'
                    : stage.skillStatus === 'missing'
                      ? 'text-warning'
                      : 'text-danger'
                }`}
              >
                {stage.skillId}
                {stage.skillStatus === 'missing'
                  ? '（缺失）'
                  : stage.skillStatus === 'disabled_untrusted'
                    ? '（未信任）'
                    : ''}
              </span>
            ) : null}
            {stage.waitingSince ? (
              <span className="shrink-0 text-[10px] text-warning">
                等待 {formatWaiting(stage.waitingSince)}
              </span>
            ) : null}
          </>
        ) : null}
        {data.injected ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
            <CircleCheck size={12} aria-hidden="true" />
            已投喂
          </span>
        ) : null}
        <span className="shrink-0 text-muted">{data.childCount ?? 0} 个节点</span>
        {actions.readOnly ? (
          <span className="shrink-0 text-muted">{group.collapsed ? '已折叠' : '已展开'}</span>
        ) : (
          <button
            type="button"
            className="nodrag inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={group.collapsed ? '展开分组' : '折叠分组'}
            onClick={() => actions.updateGroupCollapsed(data.node.id, !group.collapsed)}
          >
            {group.collapsed ? (
              <ChevronRight size={14} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} aria-hidden="true" />
            )}
            {group.collapsed ? '展开分组' : '折叠分组'}
          </button>
        )}
      </div>
    </div>
  )
}
