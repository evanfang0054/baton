import { QueryClient } from '@tanstack/react-query'

export const queryKeys = {
  workspaces: ['workspaces'] as const,
  workspaceCapabilities: (workspaceId: string) => ['workspace-capabilities', workspaceId] as const,
  workspaceBrowse: (path: string, query: string) => ['workspace-browse', path, query] as const,
  engines: ['engines'] as const,
  tasks: (workspaceId: string) => ['tasks', workspaceId] as const,
  canvas: (workspaceId: string) => ['canvas', workspaceId] as const,
  deliveries: (workspaceId: string) => ['deliveries', workspaceId] as const,
  delivery: (deliveryId: string) => ['delivery', deliveryId] as const,
  deliveryCanvas: (workspaceId: string, deliveryId: string) =>
    ['delivery-canvas', workspaceId, deliveryId] as const,
  artifacts: (deliveryId: string) => ['artifacts', deliveryId] as const,
  annotations: (deliveryId: string) => ['annotations', deliveryId] as const,
  task: (taskId: string) => ['task', taskId] as const,
  taskHistory: (taskId: string) => ['task-history', taskId] as const,
  taskAcceptance: (taskId: string) => ['task-acceptance', taskId] as const,
  sessionEvents: (sessionId: string) => ['session-events', sessionId] as const,
  supervisorStatus: ['supervisor', 'status'] as const,
  supervisorMessages: (workspaceId: string) => ['supervisor', 'messages', workspaceId] as const,
  supervisorAction: (actionId: string) => ['supervisor', 'action', actionId] as const,
  automation: (workspaceId: string) => ['automation', workspaceId] as const,
  notices: (workspaceId: string) => ['notices', workspaceId] as const,
  taskAutomation: (taskId: string) => ['task-automation', taskId] as const,
  reviewDiff: (reviewId: string) => ['review-diff', reviewId] as const,
  audit: (prefix: string) => ['audit', prefix] as const,
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  })
}

/** 任务命令后统一刷新四类任务查询，避免各调用点漏键或顺序漂移。 */
export async function invalidateTaskQueries(
  client: QueryClient,
  taskId: string,
  workspaceId?: string,
): Promise<void> {
  await client.invalidateQueries({ queryKey: queryKeys.task(taskId) })
  await client.invalidateQueries({ queryKey: queryKeys.taskHistory(taskId) })
  await client.invalidateQueries({ queryKey: queryKeys.taskAcceptance(taskId) })
  if (workspaceId) {
    await client.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
  }
}
