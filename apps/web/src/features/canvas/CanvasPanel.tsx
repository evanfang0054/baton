import type { CanvasResponse, NodeCreateValue, TaskSummary } from '@baton/protocol'
import { toast } from '@heroui/react/toast'
import { useQueryClient } from '@tanstack/react-query'
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ForwardedRef } from 'react'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { CanvasActionsProvider } from './actions'
import { CanvasToolbar } from './CanvasToolbar'
import { CreateFileNodeDialog } from './CreateFileNodeDialog'
import { toFlowEdges, toFlowNodes } from './model'
import { AgentNode } from './nodes/AgentNode'
import { FileNode } from './nodes/FileNode'
import { TextNode } from './nodes/TextNode'
import type { CanvasFlowNode } from './nodes/NodeShell'

export type CanvasAddType = 'text' | 'file' | 'agent'

export interface CanvasPanelHandle {
  addNode: (type: CanvasAddType) => void
}

interface CanvasPanelProps {
  canvas: CanvasResponse | null
  tasks: TaskSummary[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
}

const nodeTypes = { text: TextNode, file: FileNode, agent: AgentNode }
const DEFAULT_SIZE = { w: 320, h: 200 }

export const CanvasPanel = forwardRef<CanvasPanelHandle, CanvasPanelProps>(
  function CanvasPanel(props, ref) {
    return (
      <ReactFlowProvider>
        <FlowCanvas {...props} handleRef={ref} />
      </ReactFlowProvider>
    )
  },
)

function FlowCanvas({
  canvas,
  tasks,
  selectedNodeId,
  onSelectNode,
  handleRef,
}: CanvasPanelProps & {
  handleRef: ForwardedRef<CanvasPanelHandle>
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow()
  const [fileDialogOpen, setFileDialogOpen] = useState(false)

  const flowNodes = useMemo(() => {
    if (!canvas) return []
    return toFlowNodes(canvas.nodes, tasks)
  }, [canvas, tasks])
  const flowEdges = useMemo(() => (canvas ? toFlowEdges(canvas.edges) : []), [canvas])

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(flowNodes)

  useEffect(() => {
    setNodes(flowNodes as CanvasFlowNode[])
  }, [flowNodes, setNodes])

  useEffect(() => {
    setNodes((current) =>
      current.map((node) =>
        node.selected === (node.id === selectedNodeId)
          ? node
          : { ...node, selected: node.id === selectedNodeId },
      ),
    )
  }, [selectedNodeId, setNodes])

  const refreshCanvas = useCallback(async () => {
    if (!canvas) return
    await queryClient.invalidateQueries({
      queryKey: queryKeys.canvas(canvas.canvas.workspaceId),
    })
  }, [canvas, queryClient])

  const updateNode = useCallback(
    async (nodeId: string, patch: Record<string, number>) => {
      try {
        await send({ type: 'node.update', payload: { nodeId, patch } })
      } catch (cause) {
        toast.danger(cause instanceof Error ? cause.message : '节点更新失败')
      } finally {
        await refreshCanvas()
      }
    },
    [refreshCanvas, send],
  )

  const centerPosition = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 120, y: 120 }
    const point = screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
    return { x: point.x - DEFAULT_SIZE.w / 2, y: point.y - DEFAULT_SIZE.h / 2 }
  }, [screenToFlowPosition])

  const createNode = useCallback(
    async (node: NodeCreateValue) => {
      if (!canvas) return
      try {
        const result = (await send({
          type: 'node.create',
          payload: { canvasId: canvas.canvas.id, node },
        })) as { nodeId?: string } | undefined
        await refreshCanvas()
        if (result?.nodeId) onSelectNode(result.nodeId)
      } catch (cause) {
        toast.danger(cause instanceof Error ? cause.message : '节点创建失败')
      }
    },
    [canvas, onSelectNode, refreshCanvas, send],
  )

  const addNode = useCallback(
    (type: CanvasAddType) => {
      if (!canvas) return
      if (type === 'file') {
        setFileDialogOpen(true)
        return
      }
      const position = centerPosition()
      if (type === 'text') {
        void createNode({
          type: 'text',
          ...position,
          w: DEFAULT_SIZE.w,
          h: DEFAULT_SIZE.h,
          groupId: null,
          data: { content: '新文本节点' },
        })
        return
      }
      const agentCount = canvas.nodes.filter((node) => node.type === 'agent').length
      void createNode({
        type: 'agent',
        ...position,
        w: DEFAULT_SIZE.w,
        h: DEFAULT_SIZE.h,
        groupId: null,
        data: { title: `Agent ${agentCount + 1}`, engine: 'fake', taskId: null },
      })
    },
    [canvas, centerPosition, createNode],
  )

  useImperativeHandle(handleRef, () => ({ addNode }), [addNode])

  const actions = useMemo(
    () => ({
      updatePosition: (id: string, x: number, y: number) => {
        void updateNode(id, { x, y })
      },
      updateSize: (id: string, w: number, h: number) => {
        void updateNode(id, { w, h })
      },
    }),
    [updateNode],
  )

  if (!canvas) {
    return (
      <section
        data-testid="canvas"
        className="flex h-full items-center justify-center bg-background text-sm text-muted"
      >
        尚未选择工作区
      </section>
    )
  }

  return (
    <section ref={containerRef} data-testid="canvas" className="relative h-full bg-background">
      <CanvasToolbar
        onAdd={addNode}
        onFit={() => void fitView({ padding: 0.2 })}
        onZoomIn={() => void zoomIn()}
        onZoomOut={() => void zoomOut()}
      />
      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-dashed border-separator px-6 py-10 text-sm text-muted">
            画布暂无内容
          </div>
        </div>
      ) : null}
      <CanvasActionsProvider actions={actions}>
        <ReactFlow
          key={canvas.canvas.id}
          nodes={nodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={(_, node) => {
            void updateNode(node.id, { x: node.position.x, y: node.position.y })
          }}
          onSelectionChange={({ nodes: selected }) => onSelectNode(selected[0]?.id ?? null)}
          onPaneClick={() => onSelectNode(null)}
          nodesConnectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          defaultViewport={canvas.canvas.viewport}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background gap={16} />
        </ReactFlow>
      </CanvasActionsProvider>
      <CreateFileNodeDialog
        open={fileDialogOpen}
        onOpenChange={setFileDialogOpen}
        onCreate={(file) => {
          const position = centerPosition()
          void createNode({
            type: 'file',
            ...position,
            w: DEFAULT_SIZE.w,
            h: DEFAULT_SIZE.h,
            groupId: null,
            data: file,
          })
        }}
      />
    </section>
  )
}
