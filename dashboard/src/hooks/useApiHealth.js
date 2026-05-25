import { useEffect, useState } from 'react'
import { apiBaseUrl, apiClient } from '../utils/apiClient.js'

function createInitialState() {
  if (!apiBaseUrl) {
    return {
      status: 'mock',
      message: 'Mock mode enabled',
      loading: false,
      baseUrl: 'Not configured',
    }
  }

  return {
    status: 'checking',
    message: 'Checking API connectivity',
    loading: true,
    baseUrl: apiBaseUrl,
  }
}

export function useApiHealth() {
  const [state, setState] = useState(() => createInitialState())

  useEffect(() => {
    if (!apiBaseUrl) {
      return undefined
    }

    let active = true

    apiClient
      .get('/health', { timeout: 2500 })
      .then(() => {
        if (active) {
          setState({
            status: 'connected',
            message: 'API reachable',
            loading: false,
            baseUrl: apiBaseUrl,
          })
        }
      })
      .catch(() => {
        if (active) {
          setState({
            status: 'offline',
            message: 'API unreachable',
            loading: false,
            baseUrl: apiBaseUrl,
          })
        }
      })

    return () => {
      active = false
    }
  }, [])

  return state
}