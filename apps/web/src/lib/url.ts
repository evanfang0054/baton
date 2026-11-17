export function readUrlState() {
  const params = new URLSearchParams(window.location.search)
  return { workspaceId: params.get('workspace'), taskId: params.get('task') }
}

export function writeUrlState(next: { workspaceId?: string | null; taskId?: string | null }) {
  const params = new URLSearchParams(window.location.search)
  const values: Record<string, string | null | undefined> = {
    workspace: next.workspaceId,
    task: next.taskId,
  }
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}
