import { Button } from '@heroui/react/button'
import { Bot, FileText, Maximize, Type, ZoomIn, ZoomOut } from 'lucide-react'

export function CanvasToolbar({
  onAdd,
  onFit,
  onZoomIn,
  onZoomOut,
}: {
  onAdd: (type: 'text' | 'file' | 'agent') => void
  onFit: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}) {
  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-separator bg-surface p-1 shadow-surface">
      <Button
        variant="ghost"
        aria-label="添加文本"
        onPress={() => onAdd('text')}
        className="h-8 w-8 p-0"
      >
        <Type size={16} />
      </Button>
      <Button
        variant="ghost"
        aria-label="添加文件"
        onPress={() => onAdd('file')}
        className="h-8 w-8 p-0"
      >
        <FileText size={16} />
      </Button>
      <Button
        variant="ghost"
        aria-label="添加 Agent"
        onPress={() => onAdd('agent')}
        className="h-8 w-8 p-0"
      >
        <Bot size={16} />
      </Button>
      <span className="mx-1 h-5 w-px bg-separator" />
      <Button variant="ghost" aria-label="适应视图" onPress={onFit} className="h-8 w-8 p-0">
        <Maximize size={16} />
      </Button>
      <Button variant="ghost" aria-label="放大" onPress={onZoomIn} className="h-8 w-8 p-0">
        <ZoomIn size={16} />
      </Button>
      <Button variant="ghost" aria-label="缩小" onPress={onZoomOut} className="h-8 w-8 p-0">
        <ZoomOut size={16} />
      </Button>
    </div>
  )
}
