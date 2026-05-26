import { useEffect, useState } from 'react'
import { apiBaseUrl } from '../services/api.ts'

function createInitialState() {
  if (!apiBaseUrl) {
    return {
      status: 'unconfigured',
      message: 'API base URL is not configured',
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

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 2500)

    fetch(`${apiBaseUrl}/health`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
      .then(() => {
        setState({
          status: 'connected',
          message: 'API reachable',
          loading: false,
          baseUrl: apiBaseUrl,
        })
      })
      .catch(() => {
        setState({
          status: 'offline',
          message: 'API unreachable',
          loading: false,
          baseUrl: apiBaseUrl,
        })
      })

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [])

  return state
}