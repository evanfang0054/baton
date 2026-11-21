import { CircleCheck } from 'lucide-react'
import { Handle, NodeResizer, Position, useNodeId, type Node, type NodeProps } from '@xyflow/react'
import type { ReactNode } from 'react'
import type { CanvasNodeData } from '../model'
import { useCanvasActions } from '../actions'

export function NodeShell({
  selected,
  dimmed,
  injected,
  children,
}: {
  selected?: boolean
  dimmed?: boolean
  injected?: boolean
  children: ReactNode
}) {
  const id = useNodeId()
  const actions = useCanvasActions()
  const readOnly = actions.readOnly

  return (
    <div
      className={`group flex h-full w-full flex-col rounded-lg border bg-surface p-3 text-left shadow-surface ${
        selected ? 'border-accent' : 'border-separator'
      } ${dimmed ? 'pointer-events-none opacity-25' : ''}`}
    >
      <NodeResizer
        isVisible={selected && !dimmed && !readOnly}
        minWidth={160}
        minHeight={100}
        color="var(--accent)"
        onResizeEnd={(_, params) => {
          if (id && !readOnly) actions.updateSize(id, params.width, params.height)
        }}
      />
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={!readOnly}
        className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={!readOnly}
        className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
      />
      {injected ? (
        <span className="mb-1 inline-flex w-fit items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
          <CircleCheck size={12} aria-hidden="true" />
          已投喂
        </span>
      ) : null}
      {children}
    </div>
  )
}

export type CanvasFlowNode = Node<CanvasNodeData>
export type CanvasFlowNodeProps = NodeProps<CanvasFlowNode>
