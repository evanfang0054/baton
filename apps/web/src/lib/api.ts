import {
  AppError,
  AuditListResponse,
  AutomationPolicyPatch,
  AutomationSummary,
  CanvasResponse,
  DigestGenerateResponse,
  EngineListResponse,
  KillSwitchResponse,
  NoticeListResponse,
  ReviewDiffResponse,
  SessionEventsResponse,
  SupervisorActionResponse,
  SupervisorMessagesResponse,
  SupervisorStatusResponse,
  TaskAutomationSummary,
  TaskAcceptanceResponse,
  TaskDetailResponse,
  TaskHistoryResponse,
  TaskListResponse,
  WorkspaceBrowseResponse,
  WorkspaceCapabilitiesResponse,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceListResponse,
  WorkspaceTrustInput,
  WorkspaceTrustResponse,
  WorkspaceUploadInput,
  WorkspaceUploadResponse,
} from '@baton/protocol'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = '未认证') {
    super(401, 'unauthorized', message)
    this.name = 'UnauthorizedError'
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', ...init })
  if (!response.ok) {
    const parsed = AppError.safeParse(await response.json().catch(() => null))
    if (response.status === 401) {
      throw new UnauthorizedError(parsed.success ? parsed.data.message : '未认证')
    }
    if (parsed.success) {
      throw new ApiError(
        response.status,
        parsed.data.code,
        parsed.data.message,
        parsed.data.details,
      )
    }
    throw new ApiError(response.status, 'http_error', `${response.status} ${response.statusText}`)
  }
  return response.json()
}

export async function listWorkspaces() {
  return WorkspaceListResponse.parse(await request('/api/workspaces')).workspaces
}

export async function createWorkspace(input: WorkspaceCreateInput) {
  return WorkspaceCreateResponse.parse(
    await request('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

export async function browseWorkspaceDirectories(input: { path?: string; q?: string } = {}) {
  const params = new URLSearchParams()
  if (input.path) params.set('path', input.path)
  if (input.q?.trim()) params.set('q', input.q.trim())
  const query = params.toString()
  return WorkspaceBrowseResponse.parse(
    await request(`/api/workspaces/browse${query ? `?${query}` : ''}`),
  )
}

export async function updateWorkspaceTrust(workspaceId: string, input: WorkspaceTrustInput) {
  return WorkspaceTrustResponse.parse(
    await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/trust`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  ).workspace
}

export async function getWorkspaceCapabilities(workspaceId: string) {
  return WorkspaceCapabilitiesResponse.parse(
    await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/capabilities`),
  )
}

export async function uploadWorkspaceFile(workspaceId: string, input: WorkspaceUploadInput) {
  return WorkspaceUploadResponse.parse(
    await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  ).file
}

export async function cleanupWorktree(taskId: string) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}/worktree/cleanup`, {
    method: 'POST',
  })
}

export async function listEngines() {
  return EngineListResponse.parse(await request('/api/engines')).engines
}

export async function listTasks(workspaceId: string) {
  return TaskListResponse.parse(
    await request(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`),
  ).tasks
}

export async function getCanvas(workspaceId: string) {
  return CanvasResponse.parse(
    await request(`/api/canvas?workspaceId=${encodeURIComponent(workspaceId)}`),
  )
}

export async function getTask(taskId: string) {
  return TaskDetailResponse.parse(await request(`/api/tasks/${encodeURIComponent(taskId)}`))
}

export async function listSessionEvents(sessionId: string, sinceSeq = 0, limit = 500) {
  const query = new URLSearchParams({ sinceSeq: String(sinceSeq), limit: String(limit) })
  return SessionEventsResponse.parse(
    await request(`/api/sessions/${encodeURIComponent(sessionId)}/events?${query}`),
  )
}

export async function getSupervisorStatus() {
  return SupervisorStatusResponse.parse(await request('/api/supervisor/status'))
}

export async function getSupervisorMessages(workspaceId: string, before?: string, limit = 50) {
  const query = new URLSearchParams({ workspaceId, limit: String(limit) })
  if (before) query.set('before', before)
  return SupervisorMessagesResponse.parse(await request(`/api/supervisor/messages?${query}`))
}

export async function getSupervisorAction(actionId: string) {
  return SupervisorActionResponse.parse(
    await request(`/api/supervisor/actions/${encodeURIComponent(actionId)}`),
  )
}

export async function getAutomation(workspaceId: string) {
  return AutomationSummary.parse(
    await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/automation`),
  )
}

export async function updateAutomationPolicy(workspaceId: string, patch: AutomationPolicyPatch) {
  return AutomationSummary.parse(
    await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/automation`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  )
}

export async function setKillSwitch(enabled: boolean) {
  return KillSwitchResponse.parse(
    await request('/api/automation/kill-switch', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  )
}

export async function listNotices(
  workspaceId: string,
  options: { kind?: string; limit?: number; before?: number } = {},
) {
  const query = new URLSearchParams({ workspaceId, limit: String(options.limit ?? 50) })
  if (options.kind) query.set('kind', options.kind)
  if (options.before !== undefined) query.set('before', String(options.before))
  return NoticeListResponse.parse(await request(`/api/notices?${query}`))
}

export async function readNotice(id: string) {
  return request(`/api/notices/${encodeURIComponent(id)}/read`, { method: 'POST' })
}

export async function generateDigest(workspaceId: string) {
  return DigestGenerateResponse.parse(
    await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/digest`, {
      method: 'POST',
    }),
  )
}

export async function getTaskAutomation(taskId: string) {
  return TaskAutomationSummary.parse(
    await request(`/api/tasks/${encodeURIComponent(taskId)}/automation`),
  )
}

export async function listAudit(actionPrefix = 'automation.', limit = 20) {
  const query = new URLSearchParams({ limit: String(limit) })
  if (actionPrefix) query.set('actionPrefix', actionPrefix)
  return AuditListResponse.parse(await request(`/api/audit?${query}`)).entries
}

export async function getReviewDiff(reviewId: string) {
  return ReviewDiffResponse.parse(
    await request(`/api/reviews/${encodeURIComponent(reviewId)}/diff`),
  ).snapshot
}

export async function getTaskHistory(taskId: string, beforeOrdinal?: number) {
  const query = new URLSearchParams({ limit: '200' })
  if (beforeOrdinal !== undefined) query.set('beforeOrdinal', String(beforeOrdinal))
  return TaskHistoryResponse.parse(
    await request(`/api/tasks/${encodeURIComponent(taskId)}/history?${query}`),
  )
}

export async function getTaskAcceptance(taskId: string) {
  return TaskAcceptanceResponse.parse(
    await request(`/api/tasks/${encodeURIComponent(taskId)}/acceptance`),
  )
}
