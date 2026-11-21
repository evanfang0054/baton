import { Button } from '@heroui/react/button'
import {
  Bot,
  FileText,
  FolderPlus,
  Image as ImageIcon,
  Maximize,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { CanvasAddType } from './model'

const toolbarClass = [
  'absolute top-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-separator',
  'bg-surface p-1 shadow-surface',
].join(' ')

/** 图标按钮没有可见文案，用原生 title 补悬停提示；HeroUI Button 不透传 title。 */
function ToolButton({
  label,
  hint,
  onPress,
  children,
}: {
  label: string
  hint?: string
  onPress: () => void
  children: ReactNode
}) {
  return (
    <span title={hint ?? label} className="inline-flex">
      <Button variant="ghost" aria-label={label} onPress={onPress} className="h-8 w-8 p-0">
        {children}
      </Button>
    </span>
  )
}

export function CanvasToolbar({
  onAdd,
  onFit,
  onZoomIn,
  onZoomOut,
  readOnly = false,
}: {
  onAdd: (type: CanvasAddType) => void
  onFit: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  readOnly?: boolean
}) {
  return (
    <div className={toolbarClass}>
      {readOnly ? null : (
        <>
          <ToolButton label="添加文本" hint="添加文本节点" onPress={() => onAdd('text')}>
            <Type size={16} />
          </ToolButton>
          <ToolButton label="添加文件" hint="添加文件节点" onPress={() => onAdd('file')}>
            <FileText size={16} />
          </ToolButton>
          <ToolButton label="添加图片" hint="添加图片节点" onPress={() => onAdd('image')}>
            <ImageIcon size={16} />
          </ToolButton>
          <ToolButton label="建分组" hint="把选中节点放进新分组" onPress={() => onAdd('group')}>
            <FolderPlus size={16} />
          </ToolButton>
          <ToolButton label="添加 Agent" hint="添加 Agent 节点" onPress={() => onAdd('agent')}>
            <Bot size={16} />
          </ToolButton>
          <span className="mx-1 h-5 w-px bg-separator" />
        </>
      )}
      <ToolButton label="适应视图" onPress={onFit}>
        <Maximize size={16} />
      </ToolButton>
      <ToolButton label="放大" onPress={onZoomIn}>
        <ZoomIn size={16} />
      </ToolButton>
      <ToolButton label="缩小" onPress={onZoomOut}>
        <ZoomOut size={16} />
      </ToolButton>
    </div>
  )
}
