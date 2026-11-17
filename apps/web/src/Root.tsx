import { Toast } from '@heroui/react/toast'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { App } from './App'
import { createQueryClient } from './lib/query'

const queryClient = createQueryClient()

export function Root() {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
        {/* Toast.Provider 只渲染 toast region，不渲染 children，必须与 App 平级。 */}
        <Toast.Provider />
      </QueryClientProvider>
    </StrictMode>
  )
}
