import { Button } from '@heroui/react/button'
import {
  Bot,
  FileText,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  Maximize,
  Send,
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
  disabled = false,
  children,
}: {
  label: string
  hint?: string
  onPress: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <span title={hint ?? label} className="inline-flex">
      <Button
        variant="ghost"
        aria-label={label}
        isDisabled={disabled}
        onPress={onPress}
        className="h-8 w-8 p-0"
      >
        {children}
      </Button>
    </span>
  )
}

export function CanvasToolbar({
  onAdd,
  onArrange,
  arrangeDisabled = false,
  onFit,
  onZoomIn,
  onZoomOut,
  onInject,
  injectDisabled = false,
  readOnly = false,
}: {
  onAdd: (type: CanvasAddType) => void
  onArrange: () => void
  arrangeDisabled?: boolean
  onFit: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onInject: () => void
  injectDisabled?: boolean
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
          <ToolButton
            label="整理画布"
            hint="自动排列节点，保持分组"
            onPress={onArrange}
            disabled={arrangeDisabled}
          >
            <LayoutGrid size={16} />
          </ToolButton>
          <span className="mx-1 h-5 w-px bg-separator" />
          <ToolButton
            label="投喂给任务"
            hint="把选中节点补投给已有任务"
            onPress={onInject}
            disabled={injectDisabled}
          >
            <Send size={16} />
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
