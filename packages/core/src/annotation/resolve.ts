export type AnnotationResolveFacts = {
  id: string
  status: 'open' | 'resolved' | 'dismissed'
  taskId: string | null
}

export function validateAnnotationTargets(input: {
  targetNodeIds: string[]
  targetArtifactId: string | null
  nodeIds: ReadonlySet<string>
  artifactIds: ReadonlySet<string>
}): string[] {
  const issues = input.targetNodeIds
    .filter((id) => !input.nodeIds.has(id))
    .map((id) => `node_not_found:${id}`)
  if (input.targetArtifactId && !input.artifactIds.has(input.targetArtifactId)) {
    issues.push(`artifact_not_found:${input.targetArtifactId}`)
  }
  return issues
}

export function resolveAnnotationsOnApprove(
  annotations: AnnotationResolveFacts[],
  taskId: string,
): string[] {
  return annotations
    .filter((annotation) => annotation.status === 'open' && annotation.taskId === taskId)
    .map((annotation) => annotation.id)
}
