import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { Modal } from '@heroui/react/modal'
import { useRef, useState } from 'react'
import { uploadWorkspaceFile } from '../../lib/api'
import { fileToBase64 } from '../../lib/file'

export interface FileNodeValue {
  path: string
  name: string
  mime?: string
}

export function CreateFileNodeDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreate,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (file: FileNodeValue) => void
}) {
  const [path, setPath] = useState('README.md')
  const [name, setName] = useState('README.md')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const dataBase64 = await fileToBase64(file)
      const uploaded = await uploadWorkspaceFile(workspaceId, {
        name: file.name,
        ...(file.type ? { mime: file.type } : {}),
        dataBase64,
      })
      onCreate({
        name: uploaded.name,
        path: uploaded.path,
        ...(uploaded.mime ? { mime: uploaded.mime } : {}),
      })
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

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
                  placeholder="相对项目的路径，如 README.md"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  fullWidth
                />
                <div className="rounded-lg border border-dashed border-separator p-3">
                  <p className="text-xs text-muted">
                    也可以从本机选择文件；上传后会保存到项目
                    <span className="font-mono"> .baton/uploads/ </span>
                    并作为文件节点使用。
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    isDisabled={uploading}
                    onPress={() => inputRef.current?.click()}
                  >
                    {uploading ? '上传中…' : '选择文件上传'}
                  </Button>
                  <input
                    ref={inputRef}
                    type="file"
                    aria-label="选择要上传的文件"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) void upload(file)
                    }}
                  />
                </div>
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
                isDisabled={!name.trim() || !path.trim() || uploading}
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
