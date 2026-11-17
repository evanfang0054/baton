import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { Input } from '@heroui/react/input'

export function App() {
  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="text-2xl font-semibold">baton</h1>
      <div className="mt-4 flex max-w-xl items-center gap-3">
        <Button variant="primary">新建任务</Button>
        <Chip variant="soft" color="success">
          已完成
        </Chip>
        <Input placeholder="输入任务标题" fullWidth />
      </div>
    </main>
  )
}
