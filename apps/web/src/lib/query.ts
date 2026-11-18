import { QueryClient } from '@tanstack/react-query'

export const queryKeys = {
  workspaces: ['workspaces'] as const,
  engines: ['engines'] as const,
  tasks: (workspaceId: string) => ['tasks', workspaceId] as const,
  canvas: (workspaceId: string) => ['canvas', workspaceId] as const,
  task: (taskId: string) => ['task', taskId] as const,
  sessionEvents: (sessionId: string) => ['session-events', sessionId] as const,
  supervisorStatus: ['supervisor', 'status'] as const,
  supervisorMessages: (workspaceId: string) => ['supervisor', 'messages', workspaceId] as const,
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  })
}
