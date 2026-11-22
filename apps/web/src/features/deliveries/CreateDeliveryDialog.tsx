import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { Modal } from '@heroui/react/modal'
import { TextArea } from '@heroui/react/textarea'
import { toast } from '@heroui/react/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createDelivery } from '../../lib/api'
import { queryKeys } from '../../lib/query'

export function CreateDeliveryDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (deliveryId: string) => void
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!title.trim() || !goal.trim()) return
    setSaving(true)
    try {
      const created = await createDelivery({
        workspaceId,
        title: title.trim(),
        goal: goal.trim(),
        contextNodeIds: [],
        engine: 'claude-sdk',
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.deliveries(workspaceId) })
      onCreated(created.delivery.id)
      onOpenChange(false)
      setTitle('')
      setGoal('')
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '创建交付失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog aria-label="新建交付">
            <Modal.Header>
              <Modal.Heading>新建交付</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  标题
                  <Input
                    aria-label="交付标题"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="例如：优惠券领取页"
                    maxLength={200}
                    fullWidth
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  目标
                  <TextArea
                    aria-label="交付目标"
                    value={goal}
                    onChange={(event) => setGoal(event.target.value)}
                    placeholder="这条交付要解决什么问题、交付什么结果"
                    maxLength={2000}
                    fullWidth
                  />
                </label>
                <p className="text-xs text-muted">
                  会创建一块独立画布和 4 个阶段；只创建第一阶段待办，不自动开工。
                </p>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                isDisabled={saving || !title.trim() || !goal.trim()}
                onPress={() => void submit()}
              >
                {saving ? '创建中…' : '创建交付'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
