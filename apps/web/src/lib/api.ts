import {
  AppError,
  CanvasResponse,
  EngineListResponse,
  SessionEventsResponse,
  SupervisorMessagesResponse,
  SupervisorStatusResponse,
  TaskDetailResponse,
  TaskListResponse,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceListResponse,
  WorkspaceTrustInput,
  WorkspaceTrustResponse,
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

export async function updateWorkspaceTrust(workspaceId: string, input: WorkspaceTrustInput) {
  return WorkspaceTrustResponse.parse(
    await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/trust`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  ).workspace
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
