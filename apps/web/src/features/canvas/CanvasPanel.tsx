import { buildTaskScene, groupBounds } from '@baton/core'
import type { CanvasResponse, NodeCreateValue, ReviewView, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { getTask, uploadWorkspaceFile } from '../../lib/api'
import { useCommand } from '../../lib/command-context'
import { fileToBase64 } from '../../lib/file'
import { queryKeys } from '../../lib/query'
import { CommandError } from '../../lib/ws'
import { useAppStore, type SelectionNode } from '../../stores/app'
import { CanvasActionsProvider } from './actions'
import { CanvasToolbar } from './CanvasToolbar'
import { CreateFileNodeDialog } from './CreateFileNodeDialog'
import { CreateImageNodeDialog } from './CreateImageNodeDialog'
import {
  dropPatch,
  groupMovePlan,
  isValidConnection,
  mergeFlowNodes,
  nextNodePosition,
  reviewCardId,
  toFlowEdges,
  toFlowNodes,
  type CanvasAddType,
} from './model'
import { AgentNode } from './nodes/AgentNode'
import { FileNode } from './nodes/FileNode'
import { GroupNode } from './nodes/GroupNode'
import { ImageNode } from './nodes/ImageNode'
import { ReviewCardNode } from './nodes/ReviewCardNode'
import { TextNode } from './nodes/TextNode'
import type { CanvasFlowNode } from './nodes/NodeShell'
import { TaskSceneBar } from './TaskSceneBar'

export type { CanvasAddType } from './model'

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

const nodeTypes = {
  text: TextNode,
  file: FileNode,
  agent: AgentNode,
  image: ImageNode,
  group: GroupNode,
  review: ReviewCardNode,
}
const DEFAULT_SIZE = { w: 320, h: 200 }
const IMAGE_SIZE = { w: 320, h: 240 }

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
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const selectedNodeIds = useAppStore((state) => state.selectedNodeIds)
  const sceneTaskId = useAppStore((state) => state.sceneTaskId)
  const setSceneTask = useAppStore((state) => state.setSceneTask)
  const setTask = useAppStore((state) => state.setTask)
  const setRightPanel = useAppStore((state) => state.setRightPanel)

  const sceneDetail = useQuery({
    queryKey: queryKeys.task(sceneTaskId ?? ''),
    queryFn: () => getTask(sceneTaskId!),
    enabled: Boolean(sceneTaskId),
  })
  const scene = useMemo(
    () =>
      sceneDetail.data && canvas
        ? buildTaskScene(sceneDetail.data.task, canvas.nodes, canvas.edges)
        : null,
    [canvas, sceneDetail.data],
  )

  // 待验收任务卡需要 review 明细；只有 review 任务才会发请求。
  const reviewTasks = useMemo(() => tasks.filter((task) => task.status === 'review'), [tasks])
  const reviewQueries = useQueries({
    queries: reviewTasks.map((task) => ({
      queryKey: queryKeys.task(task.id),
      queryFn: () => getTask(task.id),
      staleTime: 15_000,
    })),
  })
  const reviewSignature = JSON.stringify(
    reviewQueries.map((query) => {
      const review = query.data?.review
      if (!review) return null
      return [
        review.id,
        review.verdict,
        review.verifyExitCode,
        review.preliminaryVerdict,
        review.preliminaryAt,
        review.diffStat.filesChanged,
        review.diffStat.insertions,
        review.diffStat.deletions,
      ]
    }),
  )
  const reviewDetails = useMemo(() => {
    const details: Record<string, ReviewView> = {}
    reviewQueries.forEach((query, index) => {
      const task = reviewTasks[index]
      if (task && query.data?.review) details[task.id] = query.data.review
    })
    if (sceneTaskId && sceneDetail.data?.review) {
      details[sceneTaskId] = sceneDetail.data.review
    }
    return details
    // useQueries 每次渲染都返回新数组；用内容签名稳定引用，避免画布无限同步。
  }, [reviewSignature, reviewTasks, sceneDetail.data, sceneTaskId])

  const flowNodes = useMemo(() => {
    if (!canvas) return []
    return toFlowNodes(canvas.nodes, tasks, {
      scene,
      reviewDetails,
      workspaceId: canvas.canvas.workspaceId,
    })
  }, [canvas, reviewDetails, scene, tasks])
  const flowEdges = useMemo(() => (canvas ? toFlowEdges(canvas.edges, scene) : []), [canvas, scene])

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(flowNodes)
  // React Flow 的 setNodes 每次渲染可能换身份；用 ref 只让数据/选中变化触发同步，
  // 否则会在“setNodes -> 重新测量 -> onNodesChange -> render”之间形成死循环。
  const setNodesRef = useRef(setNodes)
  setNodesRef.current = setNodes

  useEffect(() => {
    setNodesRef.current((current) => mergeFlowNodes(current, flowNodes))
  }, [flowNodes])

  // 现场只在进入/展开变化时收敛视口；用户之后仍可自己缩放。
  useEffect(() => {
    if (!scene) return
    const ids = [...scene.relatedNodeIds]
    if (scene.showReviewCard) ids.push(reviewCardId(scene.taskId))
    const timer = window.setTimeout(() => {
      void fitView({ nodes: ids.map((id) => ({ id })), padding: 0.2, duration: 300 })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fitView, scene])

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

  const createGroupFromSelection = useCallback(async () => {
    if (!canvas) return
    const selected = canvas.nodes.filter((node) => selectedNodeIds.includes(node.id))
    if (selected.length === 0) {
      toast.danger('先选择要分组的节点')
      return
    }
    if (selected.some((node) => node.type === 'group' || node.groupId !== null)) {
      toast.danger('只能对未分组的非分组节点建组')
      return
    }
    try {
      const bounds = groupBounds(selected, 24)
      await send({
        type: 'group.create',
        payload: {
          canvasId: canvas.canvas.id,
          ...bounds,
          label: '新分组',
          childIds: selected.map((node) => node.id),
        },
      })
      await refreshCanvas()
      toast.success('已建分组')
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '建组失败')
      await refreshCanvas()
    }
  }, [canvas, refreshCanvas, selectedNodeIds, send])

  const addNode = useCallback(
    (type: CanvasAddType) => {
      if (!canvas) return
      if (scene) return
      if (type === 'file') {
        setFileDialogOpen(true)
        return
      }
      if (type === 'image') {
        setImageDialogOpen(true)
        return
      }
      if (type === 'group') {
        void createGroupFromSelection()
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
    [canvas, centerPosition, createGroupFromSelection, createNode, scene],
  )

  const exitScene = useCallback(() => {
    setSceneTask(null)
    void fitView({ padding: 0.2, duration: 300 })
  }, [fitView, setSceneTask])

  useImperativeHandle(handleRef, () => ({ addNode }), [addNode])

  const handleDrop = useCallback(
    async (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setDropActive(false)
      if (!canvas || scene) return
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
    [canvas, fitView, onSelectNode, refreshCanvas, scene, screenToFlowPosition, send],
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
      updateGroupCollapsed: (id: string, collapsed: boolean) => {
        void updateNode(id, { data: { collapsed } })
      },
      openTask: (taskId: string) => {
        onSelectNode(null)
        setTask(taskId)
        setRightPanel('task')
      },
    }),
    [onSelectNode, setRightPanel, setTask, updateNode],
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
        if (scene || !event.dataTransfer.types.includes('Files')) return
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
        readOnly={Boolean(scene)}
      />
      {scene && sceneDetail.data ? (
        <TaskSceneBar scene={scene} detail={sceneDetail.data} onExit={exitScene} />
      ) : null}
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
            if (!canvas || scene) return
            if (node.data.node.type === 'group') {
              const moves = groupMovePlan(node, nodes)
              void (async () => {
                try {
                  await send({
                    type: 'node.move_many',
                    payload: { canvasId: canvas.canvas.id, moves },
                  })
                } catch (cause) {
                  toast.danger(cause instanceof Error ? cause.message : '分组移动失败')
                } finally {
                  await refreshCanvas()
                }
              })()
              return
            }
            void updateNode(node.id, dropPatch(node, nodes, canvas.nodes))
          }}
          // 用 onNodeClick 而不是 onSelectionChange：后者会在外部清空选中后
          // 把 React Flow 的旧选中反复推回 store，触发更新死循环。
          onNodeClick={(event, node) => {
            if (scene) return
            // Cmd/Ctrl/Shift 点击是多选/反选，不要覆盖单选面板状态。
            if (event.metaKey || event.ctrlKey || event.shiftKey) return
            onSelectNode(node.id)
          }}
          onSelectionChange={({ nodes: selected }) => {
            if (scene) return
            onSelectNodes(selected.map((node) => ({ id: node.id, type: node.data.node.type })))
          }}
          onPaneClick={() => {
            setSelectedEdgeId(null)
            onSelectNode(null)
          }}
          onEdgeClick={(_, edge) => {
            if (!scene) setSelectedEdgeId(edge.id)
          }}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Meta', 'Control']}
          nodesDraggable={!scene}
          nodesConnectable={!scene}
          elementsSelectable={!scene}
          edgesFocusable={!scene}
          deleteKeyCode={scene ? null : ['Backspace', 'Delete']}
          isValidConnection={(connection) => isValidConnection(connection, canvas.edges)}
          onConnect={(connection) => {
            if (!scene) void connect(connection)
          }}
          onEdgesDelete={(deleted) => {
            if (!scene) void removeEdges(deleted)
          }}
          // 节点删除必须走 NodePanel 的确认入口；键盘删除只允许删边，
          // 并连带过滤掉挂在被保护节点上的边，避免“边删了、节点没删”。
          onBeforeDelete={async ({ nodes: deletingNodes, edges: deletingEdges }) => {
            if (scene) return { nodes: [], edges: [] }
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
      <CreateImageNodeDialog
        workspaceId={canvas.canvas.workspaceId}
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        onCreate={(image) => {
          const position = centerPosition()
          void createNode({
            type: 'image',
            ...position,
            w: IMAGE_SIZE.w,
            h: IMAGE_SIZE.h,
            groupId: null,
            data: image,
          })
        }}
      />
    </section>
  )
}
