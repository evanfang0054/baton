import { useEffect } from 'react'
import { useAppStore } from '../../stores/app'
import { TaskDetailPanel } from '../tasks/TaskDetailPanel'
import { Overlay } from './Overlay'

export function StageSceneOverlay({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const setTask = useAppStore((state) => state.setTask)
  useEffect(() => {
    setTask(taskId)
    return () => setTask(null)
  }, [setTask, taskId])
  return (
    <Overlay title="阶段现场" onClose={onClose} width="min(1040px, 96vw)">
      <TaskDetailPanel />
    </Overlay>
  )
}
