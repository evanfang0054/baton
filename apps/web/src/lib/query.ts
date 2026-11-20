import { QueryClient } from '@tanstack/react-query'

export const queryKeys = {
  workspaces: ['workspaces'] as const,
  workspaceCapabilities: (workspaceId: string) => ['workspace-capabilities', workspaceId] as const,
  workspaceBrowse: (path: string, query: string) => ['workspace-browse', path, query] as const,
  engines: ['engines'] as const,
  tasks: (workspaceId: string) => ['tasks', workspaceId] as const,
  canvas: (workspaceId: string) => ['canvas', workspaceId] as const,
  task: (taskId: string) => ['task', taskId] as const,
  taskHistory: (taskId: string) => ['task-history', taskId] as const,
  sessionEvents: (sessionId: string) => ['session-events', sessionId] as const,
  supervisorStatus: ['supervisor', 'status'] as const,
  supervisorMessages: (workspaceId: string) => ['supervisor', 'messages', workspaceId] as const,
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
