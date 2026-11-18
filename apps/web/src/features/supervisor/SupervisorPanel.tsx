import type { Node as ProtocolNode } from '@baton/protocol'

export interface SupervisorTargetAgent {
  id: string
  title: string
}

export function SupervisorPanel({
  workspaceId,
  contextNodes,
  targetAgent,
}: {
  workspaceId: string | null
  contextNodes: ProtocolNode[]
  targetAgent: SupervisorTargetAgent | null
}) {
  return (
    <div data-testid="supervisor-panel" className="flex h-full flex-col gap-3 p-4">
      <h2 className="text-sm font-medium">总管</h2>
      {workspaceId ? (
        <>
          <p className="text-sm text-muted">总管会在你明确要求时创建待办任务。</p>
          <p className="text-xs text-muted">
            上下文 {contextNodes.length} 个 · 目标 Agent {targetAgent ? targetAgent.title : '未选'}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">尚未选择工作区</p>
      )}
    </div>
  )
}
