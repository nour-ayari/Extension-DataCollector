import { useSyncExternalStore } from 'react'
import { MOCK_DECISIONS } from '../mocks/data'
import { notify } from '../services/notifications'
import type { DecisionRecord } from '../types/api'

const IS_MOCK = import.meta.env.VITE_USE_MOCK_DATA === 'true'

export type WebSocketConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

export interface DecisionWebSocketEvent {
  type: string
  data: DecisionRecord
}

export interface DecisionWebSocketState {
  latestEvent: DecisionWebSocketEvent | null
  connectionStatus: WebSocketConnectionStatus
  error: string | null
}

const DEFAULT_WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined)?.trim() || 'ws://localhost:8000/ws/decisions'

const MAX_RECONNECT_DELAY_MS = 30_000
const MAX_RECONNECT_ATTEMPTS = 6

// Module-level singleton — one connection shared by all consumers.
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let shouldReconnect = false
let previousStatus: WebSocketConnectionStatus | null = null
let mockIntervalId: ReturnType<typeof setInterval> | null = null
let mockTimeoutId: ReturnType<typeof setTimeout> | null = null

let state: DecisionWebSocketState = {
  latestEvent: null,
  connectionStatus: 'reconnecting',
  error: null,
}

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function getReconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), MAX_RECONNECT_DELAY_MS)
}

function parseEvent(raw: string): DecisionWebSocketEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DecisionWebSocketEvent>

    if (typeof parsed.type !== 'string' || !parsed.data || typeof parsed.data !== 'object') {
      return null
    }

    return parsed as DecisionWebSocketEvent
  } catch {
    return null
  }
}

function setStatus(next: WebSocketConnectionStatus, error: string | null = null) {
  const prev = previousStatus
  previousStatus = next

  state = { ...state, connectionStatus: next, error }
  emit()

  if (next === 'disconnected' && prev !== 'disconnected') {
    notify.error('Live updates disconnected. Polling fallback is active.', { source: 'websocket' })
  } else if (next === 'reconnecting' && prev === 'connected') {
    notify.warning('Live updates interrupted. Reconnecting...', { source: 'websocket' })
  } else if (next === 'connected' && prev !== 'connected' && prev !== null) {
    notify.success('Live updates reconnected.', { source: 'websocket' })
  }
}

function connect(url: string) {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (socket) {
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    socket.close()
    socket = null
  }

  const ws = new WebSocket(url)
  socket = ws

  ws.onopen = () => {
    reconnectAttempts = 0
    setStatus('connected')
  }

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return

    const parsed = parseEvent(event.data)
    if (parsed) {
      state = { ...state, latestEvent: parsed }
      emit()
    }
  }

  ws.onerror = () => {
    setStatus(state.connectionStatus, 'WebSocket error')
  }

  ws.onclose = () => {
    if (!shouldReconnect) {
      setStatus('disconnected')
      return
    }

    reconnectAttempts += 1
    const next: WebSocketConnectionStatus =
      reconnectAttempts >= MAX_RECONNECT_ATTEMPTS ? 'disconnected' : 'reconnecting'
    setStatus(next)

    if (next === 'reconnecting') {
      const delay = getReconnectDelay(reconnectAttempts)
      reconnectTimer = setTimeout(() => connect(url), delay)
    }
  }
}

function startMockWebSocket() {
  mockTimeoutId = setTimeout(() => {
    reconnectAttempts = 0
    setStatus('connected')

    mockIntervalId = setInterval(() => {
      if (!shouldReconnect) return
      const base = MOCK_DECISIONS[Math.floor(Math.random() * MOCK_DECISIONS.length)]
      const liveId = `live-${Date.now()}`
      const liveRecord: DecisionRecord = {
        ...base,
        id: liveId,
        decision_id: liveId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      state = { ...state, latestEvent: { type: 'new_decision', data: liveRecord } }
      emit()
    }, 10_000)
  }, 600)
}

function ensureConnected() {
  if (!shouldReconnect) {
    shouldReconnect = true
    if (IS_MOCK) {
      startMockWebSocket()
    } else {
      connect(DEFAULT_WS_URL)
    }
  }
}

function subscribe(listener: () => void) {
  const isFirst = listeners.size === 0
  listeners.add(listener)

  if (isFirst) {
    ensureConnected()
  }

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0) {
      shouldReconnect = false

      if (mockIntervalId !== null) { clearInterval(mockIntervalId); mockIntervalId = null }
      if (mockTimeoutId !== null) { clearTimeout(mockTimeoutId); mockTimeoutId = null }

      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }

      if (socket) {
        socket.onopen = null
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        socket.close()
        socket = null
      }

      previousStatus = null
      state = { latestEvent: null, connectionStatus: 'reconnecting', error: null }
    }
  }
}

function getSnapshot() {
  return state
}

export function useDecisionWebSocket(): DecisionWebSocketState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
