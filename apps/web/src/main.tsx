import { Toast } from '@heroui/react/toast'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createQueryClient } from './lib/query'
import './styles.css'

const queryClient = createQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Toast.Provider>
        <App />
      </Toast.Provider>
    </QueryClientProvider>
  </StrictMode>,
)
