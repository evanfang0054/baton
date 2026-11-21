import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { Modal } from '@heroui/react/modal'
import { useEffect, useRef, useState } from 'react'
import { uploadWorkspaceFile } from '../../lib/api'
import { fileToBase64 } from '../../lib/file'

export interface CreateImageValue {
  src: string
  alt: string
}

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

/** 外链只做前端格式校验；daemon 不抓取，浏览器直接加载。 */
export function validateExternalImageUrl(value: string): string | null {
  if (value.length === 0 || value.length > 2048) return '图片 URL 长度不合法'
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return '只支持 https 图片外链'
    if (url.username || url.password) return '图片 URL 不能带用户名或密码'
    return null
  } catch {
    return '图片 URL 格式不正确'
  }
}

export function CreateImageNodeDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreate,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (image: CreateImageValue) => void
}) {
  const [mode, setMode] = useState<'local' | 'external'>('local')
  const [url, setUrl] = useState('')
  const [alt, setAlt] = useState('')
  const [localSrc, setLocalSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // 关闭/重开对话框后，旧上传的结果不能落到新会话里。
  const uploadGeneration = useRef(0)

  useEffect(() => {
    if (!open) return
    uploadGeneration.current += 1
    setMode('local')
    setUrl('')
    setAlt('')
    setLocalSrc(null)
    setError(null)
    setUploading(false)
  }, [open])

  const upload = async (file: File) => {
    if (
      !IMAGE_EXTENSIONS.has(extensionOf(file.name)) ||
      (file.type !== '' && !IMAGE_MIME.has(file.type))
    ) {
      setError('只支持 png/jpeg/webp/gif/svg 图片')
      return
    }
    const generation = ++uploadGeneration.current
    setUploading(true)
    setError(null)
    try {
      const dataBase64 = await fileToBase64(file)
      if (generation !== uploadGeneration.current) return
      const uploaded = await uploadWorkspaceFile(workspaceId, {
        name: file.name,
        ...(file.type ? { mime: file.type } : {}),
        dataBase64,
      })
      if (generation !== uploadGeneration.current) return
      setLocalSrc(uploaded.path)
      if (!alt.trim()) setAlt(uploaded.name)
    } catch (cause) {
      if (generation !== uploadGeneration.current) return
      setError(cause instanceof Error ? cause.message : '上传失败')
    } finally {
      if (generation === uploadGeneration.current) setUploading(false)
    }
  }

  const submit = () => {
    const src = mode === 'local' ? localSrc : url.trim()
    if (!src) {
      setError(mode === 'local' ? '请先选择图片' : '请填写图片 URL')
      return
    }
    if (mode === 'external') {
      const invalid = validateExternalImageUrl(src)
      if (invalid) {
        setError(invalid)
        return
      }
    }
    setError(null)
    onCreate({ src, alt: alt.trim() || '图片' })
    onOpenChange(false)
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Trigger className="sr-only" aria-hidden="true" tabIndex={-1}>
        添加图片
      </Modal.Trigger>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>添加图片节点</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={mode === 'local' ? 'primary' : 'tertiary'}
                    onPress={() => {
                      setMode('local')
                      setError(null)
                    }}
                  >
                    本地上传
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === 'external' ? 'primary' : 'tertiary'}
                    onPress={() => {
                      setMode('external')
                      setError(null)
                    }}
                  >
                    外链
                  </Button>
                </div>
                {mode === 'local' ? (
                  <div className="rounded-lg border border-dashed border-separator p-3">
                    <p className="text-xs text-muted">
                      图片会保存到工作区
                      <span className="font-mono"> .baton/uploads/ </span>
                      并通过受保护路由读取。
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2"
                      isDisabled={uploading}
                      onPress={() => inputRef.current?.click()}
                    >
                      {uploading ? '上传中…' : '选择图片'}
                    </Button>
                    <input
                      ref={inputRef}
                      type="file"
                      aria-label="选择要上传的图片"
                      accept=".png,.jpg,.jpeg,.webp,.gif,.svg,image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (file) void upload(file)
                      }}
                    />
                    {localSrc ? (
                      <p className="mt-2 break-all font-mono text-xs text-muted">{localSrc}</p>
                    ) : null}
                  </div>
                ) : (
                  <Input
                    aria-label="图片 URL"
                    placeholder="https://example.com/image.png"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    fullWidth
                  />
                )}
                <Input
                  aria-label="图片描述"
                  placeholder="可选，便于识别"
                  value={alt}
                  maxLength={200}
                  onChange={(event) => setAlt(event.target.value)}
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
              <Button variant="primary" isDisabled={uploading} onPress={submit}>
                添加
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
