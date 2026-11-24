export function readUrlState() {
  const params = new URLSearchParams(window.location.search)
  return {
    workspaceId: params.get('workspace'),
    taskId: params.get('task'),
    deliveryId: params.get('delivery'),
    stageKey: params.get('stage'),
    artifactId: params.get('artifact'),
    annotationId: params.get('annotation'),
  }
}

export function writeUrlState(next: {
  workspaceId?: string | null
  taskId?: string | null
  deliveryId?: string | null
  stageKey?: string | null
  artifactId?: string | null
  annotationId?: string | null
}) {
  const params = new URLSearchParams(window.location.search)
  const values: Record<string, string | null | undefined> = {
    workspace: next.workspaceId,
    task: next.taskId,
    delivery: next.deliveryId,
    stage: next.stageKey,
    artifact: next.artifactId,
    annotation: next.annotationId,
  }
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}
