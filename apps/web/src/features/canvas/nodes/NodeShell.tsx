import { Handle, NodeResizer, Position, useNodeId, type Node, type NodeProps } from '@xyflow/react'
import type { ReactNode } from 'react'
import type { CanvasNodeData } from '../model'
import { useCanvasActions } from '../actions'

export function NodeShell({
  selected,
  dimmed,
  children,
}: {
  selected?: boolean
  dimmed?: boolean
  children: ReactNode
}) {
  const id = useNodeId()
  const actions = useCanvasActions()

  return (
    <div
      className={`group flex h-full w-full flex-col rounded-lg border bg-surface p-3 text-left shadow-surface ${
        selected ? 'border-accent' : 'border-separator'
      } ${dimmed ? 'pointer-events-none opacity-25' : ''}`}
    >
      <NodeResizer
        isVisible={selected && !dimmed}
        minWidth={160}
        minHeight={100}
        color="var(--accent)"
        onResizeEnd={(_, params) => {
          if (id) actions.updateSize(id, params.width, params.height)
        }}
      />
      <Handle
        type="target"
        position={Position.Top}
        isConnectable
        className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable
        className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
      />
      {children}
    </div>
  )
}

export type CanvasFlowNode = Node<CanvasNodeData>
export type CanvasFlowNodeProps = NodeProps<CanvasFlowNode>
