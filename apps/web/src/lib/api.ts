import {
  CanvasResponse,
  TaskDetailResponse,
  TaskListResponse,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceListResponse,
} from '@baton/protocol'

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', ...init })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      code?: string
      message?: string
    } | null
    throw new Error(body?.message ?? `${response.status} ${response.statusText}`)
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
