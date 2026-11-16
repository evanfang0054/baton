import { ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

export function App() {
  return (
    <div className="shell">
      <aside data-testid="kanban" className="panel kanban">
        <h2>任务</h2>
        <ul>
          <li>待办</li>
          <li>进行中</li>
          <li>待验收</li>
          <li>已交付</li>
        </ul>
      </aside>
      <main data-testid="canvas" className="panel canvas">
        <ReactFlow nodes={[]} edges={[]} fitView />
      </main>
      <aside data-testid="supervisor" className="panel supervisor">
        <h2>总管</h2>
        <p>尚未接入模型</p>
        <textarea disabled placeholder="M1 开放" />
      </aside>
    </div>
  )
}
