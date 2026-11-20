import type { CanvasResponse, NodeCreateValue, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQueryClient } from '@tanstack/react-query'
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
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
import type { DragEvent as ReactDragEvent, ForwardedRef } from 'react'
import { uploadWorkspaceFile } from '../../lib/api'
import { useCommand } from '../../lib/command-context'
import { fileToBase64 } from '../../lib/file'
import { queryKeys } from '../../lib/query'
import { CommandError } from '../../lib/ws'
import type { SelectionNode } from '../../stores/app'
import { CanvasActionsProvider } from './actions'
import { CanvasToolbar } from './CanvasToolbar'
import { CreateFileNodeDialog } from './CreateFileNodeDialog'
import {
  isValidConnection,
  mergeFlowNodes,
  nextNodePosition,
  toFlowEdges,
  toFlowNodes,
} from './model'
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
  onSelectNodes: (nodes: SelectionNode[]) => void
}

const nodeTypes = { text: TextNode, file: FileNode, agent: AgentNode }
const DEFAULT_SIZE = { w: 320, h: 200 }

const DROP_OVERLAY_CLASS = [
  'pointer-events-none absolute inset-0 z-20 flex items-center justify-center',
  'bg-accent/10 ring-2 ring-accent ring-inset',
].join(' ')

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
  onSelectNodes,
  handleRef,
}: CanvasPanelProps & {
  handleRef: ForwardedRef<CanvasPanelHandle>
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow()
  const [fileDialogOpen, setFileDialogOpen] = useState(false)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)

  const flowNodes = useMemo(() => {
    if (!canvas) return []
    return toFlowNodes(canvas.nodes, tasks)
  }, [canvas, tasks])
  const flowEdges = useMemo(() => (canvas ? toFlowEdges(canvas.edges) : []), [canvas])

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(flowNodes)
  // React Flow 的 setNodes 每次渲染可能换身份；用 ref 只让数据/选中变化触发同步，
  // 否则会在“setNodes -> 重新测量 -> onNodesChange -> render”之间形成死循环。
  const setNodesRef = useRef(setNodes)
  setNodesRef.current = setNodes

  useEffect(() => {
    setNodesRef.current((current) => mergeFlowNodes(current, flowNodes))
  }, [flowNodes])

  // React Flow 自己维护选中态；外部清空 selectedNodeId（如打开任务、关闭节点详情）时
  // 同步清掉它的选中标记，避免画布上残留高亮。只在目标尚未选中时补选中，
  // 否则会把 Cmd/Ctrl 多选收敛成单选。
  useEffect(() => {
    setNodes((current) => {
      if (selectedNodeId === null) {
        return current.every((node) => !node.selected)
          ? current
          : current.map((node) => (node.selected ? { ...node, selected: false } : node))
      }
      const target = current.find((node) => node.id === selectedNodeId)
      if (!target || target.selected) return current
      return current.map((node) => ({ ...node, selected: node.id === selectedNodeId }))
    })
  }, [selectedNodeId, setNodes])

  const refreshCanvas = useCallback(async () => {
    if (!canvas) return
    await queryClient.invalidateQueries({
      queryKey: queryKeys.canvas(canvas.canvas.workspaceId),
    })
  }, [canvas, queryClient])

  const updateNode = useCallback(
    async (nodeId: string, patch: Record<string, unknown>) => {
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

  const connect = useCallback(
    async (connection: Connection) => {
      if (!canvas || !isValidConnection(connection, canvas.edges)) return
      try {
        await send({
          type: 'edge.create',
          payload: {
            sourceId: connection.source,
            targetId: connection.target,
            type: 'context',
          },
        })
      } catch (cause) {
        toast.danger(cause instanceof Error ? cause.message : '连线创建失败')
      } finally {
        await refreshCanvas()
      }
    },
    [canvas, refreshCanvas, send],
  )

  const removeEdges = useCallback(
    async (deleted: Array<{ id: string }>) => {
      for (const edge of deleted) {
        try {
          await send({ type: 'edge.delete', payload: { edgeId: edge.id } })
        } catch (cause) {
          if (cause instanceof CommandError && cause.code === 'edge_not_found') continue
          toast.danger(cause instanceof Error ? cause.message : '连线删除失败')
          break
        }
      }
      setSelectedEdgeId(null)
      await refreshCanvas()
    },
    [refreshCanvas, send],
  )

  const deleteSelectedEdge = useCallback(() => {
    const edge = canvas?.edges.find((item) => item.id === selectedEdgeId)
    if (edge) void removeEdges([{ id: edge.id }])
  }, [canvas?.edges, removeEdges, selectedEdgeId])

  const centerPosition = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 120, y: 120 }
    const point = screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
    const topLeft = screenToFlowPosition({ x: rect.left, y: rect.top })
    const bottomRight = screenToFlowPosition({ x: rect.right, y: rect.bottom })
    return nextNodePosition(point, DEFAULT_SIZE, canvas?.nodes ?? [], 24, {
      minX: topLeft.x,
      minY: topLeft.y,
      maxX: bottomRight.x,
      maxY: bottomRight.y,
    })
  }, [canvas?.nodes, screenToFlowPosition])

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

  const handleDrop = useCallback(
    async (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setDropActive(false)
      if (!canvas) return
      const files = Array.from(event.dataTransfer.files)
      if (files.length === 0) return

      const rect = containerRef.current?.getBoundingClientRect()
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const bounds = rect
        ? (() => {
            const topLeft = screenToFlowPosition({ x: rect.left, y: rect.top })
            const bottomRight = screenToFlowPosition({ x: rect.right, y: rect.bottom })
            return {
              minX: topLeft.x,
              minY: topLeft.y,
              maxX: bottomRight.x,
              maxY: bottomRight.y,
            }
          })()
        : undefined

      const accepted = files.slice(0, 10)
      if (files.length > accepted.length) {
        toast.danger('一次最多拖入 10 个文件')
      }

      let added = 0
      let failed = 0
      const createdNodeIds: string[] = []
      const created: Array<{ x: number; y: number; w: number; h: number }> = []
      for (const file of accepted) {
        try {
          const dataBase64 = await fileToBase64(file)
          const uploaded = await uploadWorkspaceFile(canvas.canvas.workspaceId, {
            name: file.name,
            ...(file.type ? { mime: file.type } : {}),
            dataBase64,
          })
          const position = nextNodePosition(
            point,
            DEFAULT_SIZE,
            [...canvas.nodes, ...created],
            24,
            bounds,
          )
          const result = (await send({
            type: 'node.create',
            payload: {
              canvasId: canvas.canvas.id,
              node: {
                type: 'file',
                ...position,
                w: DEFAULT_SIZE.w,
                h: DEFAULT_SIZE.h,
                groupId: null,
                data: {
                  name: uploaded.name,
                  path: uploaded.path,
                  ...(uploaded.mime ? { mime: uploaded.mime } : {}),
                },
              },
            },
          })) as { nodeId?: string } | undefined
          created.push({ ...position, w: DEFAULT_SIZE.w, h: DEFAULT_SIZE.h })
          if (result?.nodeId) {
            createdNodeIds.push(result.nodeId)
            added += 1
          }
        } catch {
          failed += 1
        }
      }

      await refreshCanvas()
      if (createdNodeIds.length > 0) {
        onSelectNode(createdNodeIds[createdNodeIds.length - 1]!)
        const outside =
          bounds !== undefined &&
          created.some(
            (rect) =>
              rect.x < bounds.minX ||
              rect.y < bounds.minY ||
              rect.x + rect.w > bounds.maxX ||
              rect.y + rect.h > bounds.maxY,
          )
        if (outside) {
          void fitView({
            nodes: createdNodeIds.map((id) => ({ id })),
            duration: 300,
            padding: 1.5,
            maxZoom: 1,
          })
        }
      }
      if (added > 0) toast.success(`已添加 ${added} 个文件节点`)
      if (failed > 0) toast.danger(`${failed} 个文件上传失败`)
    },
    [canvas, fitView, onSelectNode, refreshCanvas, screenToFlowPosition, send],
  )

  const actions = useMemo(
    () => ({
      updatePosition: (id: string, x: number, y: number) => {
        void updateNode(id, { x, y })
      },
      updateSize: (id: string, w: number, h: number) => {
        void updateNode(id, { w, h })
      },
      updateContent: (id: string, content: string) => {
        void updateNode(id, { data: { content } })
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
    <section
      ref={containerRef}
      data-testid="canvas"
      className="relative h-full bg-background"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDropActive(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) return
        setDropActive(false)
      }}
      onDrop={(event) => void handleDrop(event)}
    >
      <CanvasToolbar
        onAdd={addNode}
        onFit={() => void fitView({ padding: 0.2 })}
        onZoomIn={() => void zoomIn()}
        onZoomOut={() => void zoomOut()}
      />
      {selectedEdgeId ? (
        <div className="absolute top-3 right-3 z-10">
          <Button variant="danger" onPress={deleteSelectedEdge}>
            删除连线
          </Button>
        </div>
      ) : null}
      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-dashed border-separator px-6 py-10 text-sm text-muted">
            画布暂无内容
          </div>
        </div>
      ) : null}
      {dropActive ? (
        <div className={DROP_OVERLAY_CLASS}>
          <div className="rounded-lg border border-accent bg-surface px-4 py-2 text-sm text-foreground shadow-overlay">
            松开以添加文件节点
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
          // 用 onNodeClick 而不是 onSelectionChange：后者会在外部清空选中后
          // 把 React Flow 的旧选中反复推回 store，触发更新死循环。
          onNodeClick={(event, node) => {
            // Cmd/Ctrl/Shift 点击是多选/反选，不要覆盖单选面板状态。
            if (event.metaKey || event.ctrlKey || event.shiftKey) return
            onSelectNode(node.id)
          }}
          onSelectionChange={({ nodes: selected }) =>
            onSelectNodes(selected.map((node) => ({ id: node.id, type: node.data.node.type })))
          }
          onPaneClick={() => {
            setSelectedEdgeId(null)
            onSelectNode(null)
          }}
          onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Meta', 'Control']}
          nodesConnectable
          edgesFocusable
          deleteKeyCode={['Backspace', 'Delete']}
          isValidConnection={(connection) => isValidConnection(connection, canvas.edges)}
          onConnect={(connection) => void connect(connection)}
          onEdgesDelete={(deleted) => void removeEdges(deleted)}
          // 节点删除必须走 NodePanel 的确认入口；键盘删除只允许删边，
          // 并连带过滤掉挂在被保护节点上的边，避免“边删了、节点没删”。
          onBeforeDelete={async ({ nodes: deletingNodes, edges: deletingEdges }) => {
            if (deletingNodes.length === 0) {
              return { nodes: [], edges: deletingEdges }
            }
            const blocked = new Set(deletingNodes.map((node) => node.id))
            return {
              nodes: [],
              edges: deletingEdges.filter(
                (edge) => !blocked.has(edge.source) && !blocked.has(edge.target),
              ),
            }
          }}
          defaultViewport={canvas.canvas.viewport}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background gap={16} />
        </ReactFlow>
      </CanvasActionsProvider>
      <CreateFileNodeDialog
        workspaceId={canvas.canvas.workspaceId}
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
