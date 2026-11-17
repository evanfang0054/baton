import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { Modal } from '@heroui/react/modal'
import { useState } from 'react'

export function CreateFileNodeDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (file: { path: string; name: string }) => void
}) {
  const [path, setPath] = useState('README.md')
  const [name, setName] = useState('README.md')
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Trigger className="sr-only" aria-hidden="true" tabIndex={-1}>
        添加文件
      </Modal.Trigger>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>添加文件节点</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-3">
                <Input
                  aria-label="文件名称"
                  placeholder="名称，如 README.md"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  fullWidth
                />
                <Input
                  aria-label="文件路径"
                  placeholder="相对工作区的路径，如 README.md"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  fullWidth
                />
                {error ? (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                isDisabled={!name.trim() || !path.trim()}
                onPress={() => {
                  if (!name.trim() || !path.trim()) {
                    setError('名称和路径不能为空')
                    return
                  }
                  setError(null)
                  onCreate({ name: name.trim(), path: path.trim() })
                  onOpenChange(false)
                }}
              >
                添加
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
