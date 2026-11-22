import type { AutomationPolicyPatch } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { Modal } from '@heroui/react/modal'
import { toast } from '@heroui/react/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { getAutomation, listAudit, setKillSwitch, updateAutomationPolicy } from '../../lib/api'
import { queryKeys } from '../../lib/query'

type Risk = 'low' | 'medium'
type AutonomyMode = 'off' | 'observe' | 'auto'

export function AutomationSettingsDialog({
  workspaceId,
  open,
  onOpenChange,
  mobile = false,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  mobile?: boolean
}) {
  const queryClient = useQueryClient()
  const summary = useQuery({
    queryKey: queryKeys.automation(workspaceId),
    queryFn: () => getAutomation(workspaceId),
    enabled: open && Boolean(workspaceId),
  })
  const audit = useQuery({
    queryKey: queryKeys.audit('automation.'),
    queryFn: () => listAudit('automation.'),
    enabled: open,
  })
  const [enabled, setEnabled] = useState(false)
  const [retryMax, setRetryMax] = useState(2)
  const [risk, setRisk] = useState<Risk>('low')
  const [delegatedAuthority, setDelegatedAuthority] = useState(false)
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>('observe')
  const [autoRetry, setAutoRetry] = useState<AutonomyMode>('off')
  const [attentionReminder, setAttentionReminder] = useState<AutonomyMode>('observe')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const syncedVersion = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      syncedVersion.current = null
      return
    }
    if (!summary.data) return
    const version = summary.data.policyVersion
    if (syncedVersion.current === version) return
    syncedVersion.current = version
    setEnabled(summary.data.policy.autopilot.enabled)
    setRetryMax(summary.data.policy.autopilot.retryMax)
    setDelegatedAuthority(summary.data.policy.autopilot.delegatedAuthority)
    setRisk(summary.data.policy.approval.autoApproveMaxRisk === 'medium' ? 'medium' : 'low')
    setAutonomyMode(summary.data.policy.autonomy.mode)
    setAutoRetry(summary.data.policy.autonomy.autoRetry)
    setAttentionReminder(summary.data.policy.autonomy.attentionReminder)
    setError(null)
  }, [open, summary.data])

  const current = summary.data
  const patch: AutomationPolicyPatch = {}
  if (current) {
    const autopilot: {
      enabled?: boolean
      retryMax?: number
      delegatedAuthority?: boolean
    } = {}
    const desiredEnabled = enabled || delegatedAuthority
    if (desiredEnabled !== current.policy.autopilot.enabled) autopilot.enabled = desiredEnabled
    if (retryMax !== current.policy.autopilot.retryMax) autopilot.retryMax = retryMax
    if (delegatedAuthority !== current.policy.autopilot.delegatedAuthority) {
      autopilot.delegatedAuthority = delegatedAuthority
    }
    if (Object.keys(autopilot).length > 0) patch.autopilot = autopilot

    const approval: { autoApproveMaxRisk?: Risk } = {}
    if (risk !== current.policy.approval.autoApproveMaxRisk) {
      approval.autoApproveMaxRisk = risk
    }
    if (Object.keys(approval).length > 0) patch.approval = approval

    const autonomy: {
      mode?: AutonomyMode
      autoRetry?: AutonomyMode
      attentionReminder?: AutonomyMode
    } = {}
    if (autonomyMode !== current.policy.autonomy.mode) autonomy.mode = autonomyMode
    if (autoRetry !== current.policy.autonomy.autoRetry) autonomy.autoRetry = autoRetry
    if (attentionReminder !== current.policy.autonomy.attentionReminder) {
      autonomy.attentionReminder = attentionReminder
    }
    if (Object.keys(autonomy).length > 0) patch.autonomy = autonomy
  }
  const hasChanges = Object.keys(patch).length > 0

  const save = async () => {
    if (!current || !hasChanges) return
    setSaving(true)
    setError(null)
    try {
      await updateAutomationPolicy(workspaceId, patch)
      await queryClient.invalidateQueries({ queryKey: queryKeys.automation(workspaceId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.audit('automation.') })
      toast.success('自动化设置已保存')
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const restore = async () => {
    setRestoring(true)
    setError(null)
    try {
      await setKillSwitch(false)
      await queryClient.invalidateQueries({ queryKey: ['automation'] })
      await queryClient.invalidateQueries({ queryKey: queryKeys.audit('automation.') })
      toast.success('自动化已恢复')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复失败')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog
            data-testid="automation-settings"
            className={mobile ? 'h-dvh w-screen max-w-none rounded-none' : undefined}
          >
            <Modal.Header>
              <Modal.Heading>自动化设置</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {summary.isLoading ? (
                <p className="text-sm text-muted">加载中…</p>
              ) : summary.isError || !current ? (
                <p role="alert" className="text-sm text-danger">
                  自动化设置加载失败
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {current.killSwitch ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-warning bg-warning/10 p-2 text-xs text-warning">
                      <span>
                        {current.killSwitchForced
                          ? '自动化已被环境变量强制暂停。'
                          : '自动化已暂停：不会自动批准或自动重试。'}
                      </span>
                      {current.killSwitchForced ? null : (
                        <Button
                          variant="secondary"
                          isDisabled={restoring}
                          onPress={() => void restore()}
                        >
                          恢复自动化
                        </Button>
                      )}
                    </div>
                  ) : null}
                  {!current.trusted ? (
                    <p className="rounded-md border border-warning bg-warning/10 p-2 text-xs text-warning">
                      先信任工作区，才能启用自动化。
                    </p>
                  ) : null}
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>自动驾驶</span>
                    <input
                      type="checkbox"
                      aria-label="自动驾驶"
                      checked={enabled || delegatedAuthority}
                      disabled={!current.trusted || delegatedAuthority}
                      onChange={(event) => setEnabled(event.target.checked)}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>总管全权（含高风险自动批准）</span>
                    <input
                      type="checkbox"
                      aria-label="总管全权"
                      checked={delegatedAuthority}
                      disabled={!current.trusted}
                      onChange={(event) => {
                        setDelegatedAuthority(event.target.checked)
                        if (event.target.checked) setEnabled(true)
                      }}
                    />
                  </label>
                  <p className="text-xs text-warning">
                    总管全权只对总管创建的任务生效：除 deny 规则外，所有工具（含高风险
                    Bash）都会自动批准。每次自动决定写入审计，kill switch 可随时停止。
                  </p>
                  <section className="flex flex-col gap-2 rounded-md border border-separator p-2">
                    <h3 className="text-sm font-medium text-foreground">总管自治</h3>
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>全局模式</span>
                      <select
                        aria-label="总管全局模式"
                        value={autonomyMode}
                        onChange={(event) => setAutonomyMode(event.target.value as AutonomyMode)}
                        className="h-9 rounded-lg border border-separator bg-surface px-2 text-sm"
                      >
                        <option value="off">off</option>
                        <option value="observe">observe</option>
                        <option value="auto">auto</option>
                      </select>
                    </label>
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>失败自动重试</span>
                      <select
                        aria-label="失败自动重试"
                        value={autoRetry}
                        onChange={(event) => setAutoRetry(event.target.value as AutonomyMode)}
                        className="h-9 rounded-lg border border-separator bg-surface px-2 text-sm"
                      >
                        <option value="off">off</option>
                        <option value="observe">observe</option>
                        <option value="auto">auto</option>
                      </select>
                    </label>
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>注意力提醒</span>
                      <select
                        aria-label="注意力提醒"
                        value={attentionReminder}
                        onChange={(event) =>
                          setAttentionReminder(event.target.value as AutonomyMode)
                        }
                        className="h-9 rounded-lg border border-separator bg-surface px-2 text-sm"
                      >
                        <option value="off">off</option>
                        <option value="observe">observe</option>
                        <option value="auto">auto</option>
                      </select>
                    </label>
                    <p className="text-xs text-muted">
                      修改只影响新提议；已提议的动作仍可应用或忽略。kill switch 下 auto
                      停止，observe 仍记录。
                    </p>
                  </section>
                  <p className="text-xs text-muted">
                    总管任务进入待验收时会派一个新的验收 Agent
                    做初步检查；初步结论只作建议，任务仍会停在待验收，最终通过或打回由你决定。
                  </p>
                  <label className="flex flex-col gap-1 text-sm">
                    <span>最大自动重试次数</span>
                    <Input
                      aria-label="最大自动重试次数"
                      type="number"
                      min={0}
                      max={10}
                      value={String(retryMax)}
                      onChange={(event) => setRetryMax(Number(event.target.value))}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span>自动批准风险上限</span>
                    <select
                      aria-label="自动批准风险上限"
                      value={risk}
                      onChange={(event) => setRisk(event.target.value as Risk)}
                      className="h-9 rounded-lg border border-separator bg-surface px-2 text-sm"
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                    </select>
                  </label>
                  <p className="text-xs text-muted">
                    修改只影响新启动的会话；运行中的任务使用启动时的策略快照。未开启总管全权时，高风险操作永远不会自动批准。
                  </p>
                  {current.digestCronUnsupported ? (
                    <p className="text-xs text-warning">
                      当前 digestCron 不在支持范围内，定时汇报已停用；仍可手动生成。
                    </p>
                  ) : null}
                  <section className="flex flex-col gap-1 text-xs text-muted">
                    <h3 className="text-sm font-medium text-foreground">只读策略</h3>
                    <p>verify：{current.policy.verify.command ?? '自动解析'}</p>
                    <p>digest：{current.policy.autopilot.digestCron}</p>
                    <p>allow：{current.policy.approval.allow.join('、') || '无'}</p>
                    <p>deny：{current.policy.approval.deny.join('、') || '无'}</p>
                  </section>
                  <section className="flex flex-col gap-1 text-xs text-muted">
                    <h3 className="text-sm font-medium text-foreground">最近变更</h3>
                    {(audit.data ?? []).length === 0 ? (
                      <p>暂无自动化变更</p>
                    ) : (
                      (audit.data ?? []).slice(0, 10).map((entry) => (
                        <p key={entry.id}>
                          {new Date(entry.ts).toLocaleString('zh-CN')} · {entry.action}
                        </p>
                      ))
                    )}
                  </section>
                  {error ? (
                    <p role="alert" className="text-sm text-danger">
                      {error}
                    </p>
                  ) : null}
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button
                variant="primary"
                isDisabled={saving || !current?.trusted || !hasChanges}
                onPress={() => void save()}
              >
                保存
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
