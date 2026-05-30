import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type PropsWithChildren } from 'react'

const queryClientOptions = {
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
}

export function QueryProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient(queryClientOptions))

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}