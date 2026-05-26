import type { ActionType, ActionUrgency, DecisionRecord } from '../types/api'

export type NotificationLevel = 'success' | 'error' | 'warning' | 'critical'
export type NotificationKind = 'view-decision' | 'open-url' | 'dismiss'

export interface NotificationAction {
  label: string
  kind: NotificationKind
  decisionId?: string
  href?: string
  destructive?: boolean
}

export interface NotificationOptions {
  actions?: NotificationAction[]
  sound?: boolean
  source?: string
  metadata?: Record<string, unknown>
}

export interface NotificationItem {
  id: string
  level: NotificationLevel
  message: string
  createdAt: number
  readAt: number | null
  dismissedAt: number | null
  expiresAt: number | null
  persistent: boolean
  sound: boolean
  source?: string
  actions: NotificationAction[]
  metadata?: Record<string, unknown>
}

export interface NotificationState {
  notifications: NotificationItem[]
  unreadCount: number
  doNotDisturb: boolean
  browserPermission: NotificationPermission | 'unsupported'
}

const STORAGE_KEY = 'dashboard.notifications.v1'
const MAX_HISTORY = 50
const MAX_TOASTS = 4
const AUTO_DISMISS_MS = 5000

const listeners = new Set<() => void>()
let state = hydrateState()
let browserNotificationPermission: NotificationPermission | 'unsupported' = state.browserPermission

function hydrateState(): NotificationState {
  if (typeof window === 'undefined') {
    return {
      notifications: [],
      unreadCount: 0,
      doNotDisturb: false,
      browserPermission: 'unsupported',
    }
  }

  const browserPermission: NotificationPermission | 'unsupported' = 'Notification' in window ? window.Notification.permission : 'unsupported'

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        notifications: [],
        unreadCount: 0,
        doNotDisturb: false,
        browserPermission,
      }
    }

    const parsed = JSON.parse(raw) as Partial<NotificationState>
    const notifications = Array.isArray(parsed.notifications) ? (parsed.notifications as NotificationItem[]) : []
    return {
      notifications: notifications.slice(0, MAX_HISTORY),
      unreadCount: typeof parsed.unreadCount === 'number' ? parsed.unreadCount : notifications.filter((item) => item.readAt === null).length,
      doNotDisturb: Boolean(parsed.doNotDisturb),
      browserPermission,
    }
  } catch {
    return {
      notifications: [],
      unreadCount: 0,
      doNotDisturb: false,
      browserPermission,
    }
  }
}

function persistState(): void {
  if (typeof window === 'undefined') {
    return
  }

  const payload: NotificationState = {
    notifications: state.notifications.slice(0, MAX_HISTORY),
    unreadCount: state.unreadCount,
    doNotDisturb: state.doNotDisturb,
    browserPermission: browserNotificationPermission,
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

function emit(): void {
  persistState()
  for (const listener of listeners) {
    listener()
  }
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function canBrowserNotify(level: NotificationLevel): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false
  }

  if (browserNotificationPermission !== 'granted') {
    return false
  }

  if (state.doNotDisturb && level !== 'critical') {
    return false
  }

  return true
}

function playTone(level: NotificationLevel, metadata?: Record<string, unknown>): void {
  if (typeof window === 'undefined') {
    return
  }

  if (state.doNotDisturb && level !== 'critical') {
    return
  }

  try {
    const audioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!audioContextConstructor) {
      return
    }

    const context = new audioContextConstructor()
    const oscillator = context.createOscillator()
    const gainNode = context.createGain()

    const vipBonus = metadata?.vip === true ? 1.1 : 1
    const frequencies: Record<NotificationLevel, number> = {
      success: 660,
      warning: 520,
      error: 420,
      critical: 880,
    }

    oscillator.type = level === 'critical' ? 'sine' : 'triangle'
    oscillator.frequency.value = frequencies[level] * vipBonus
    gainNode.gain.value = level === 'critical' ? 0.035 : 0.02

    oscillator.connect(gainNode)
    gainNode.connect(context.destination)
    oscillator.start()

    window.setTimeout(() => {
      oscillator.stop(context.currentTime + (level === 'critical' ? 0.18 : 0.12))
      window.setTimeout(() => void context.close(), 250)
    }, 80)
  } catch {
    // Optional audio feedback only.
  }
}

function showBrowserNotification(item: NotificationItem): void {
  if (!canBrowserNotify(item.level)) {
    return
  }

  const notification = new window.Notification(item.level === 'critical' ? 'Critical decision' : item.level.charAt(0).toUpperCase() + item.level.slice(1), {
    body: item.message,
    tag: item.id,
    silent: item.sound ? false : true,
  })

  notification.onclick = () => {
    window.focus()
    markRead(item.id)
    if (item.actions.length > 0) {
      dispatchNotificationAction(item.actions[0])
    }
  }
}

function enqueue(level: NotificationLevel, message: string, options: NotificationOptions = {}): NotificationItem {
  const createdAt = Date.now()
  const persistent = level === 'critical'
  const item: NotificationItem = {
    id: createId(),
    level,
    message,
    createdAt,
    readAt: null,
    dismissedAt: null,
    expiresAt: persistent ? null : createdAt + AUTO_DISMISS_MS,
    persistent,
    sound: options.sound ?? level === 'critical',
    source: options.source,
    actions: options.actions ?? [],
    metadata: options.metadata,
  }

  state = {
    ...state,
    notifications: [item, ...state.notifications].slice(0, MAX_HISTORY),
    unreadCount: state.unreadCount + 1,
  }

  if (item.sound) {
    playTone(level, options.metadata)
  }

  showBrowserNotification(item)
  emit()
  return item
}

function updateNotification(id: string, updater: (item: NotificationItem) => NotificationItem): void {
  const nextNotifications = state.notifications.map((item) => (item.id === id ? updater(item) : item))
  state = {
    ...state,
    notifications: nextNotifications,
    unreadCount: nextNotifications.filter((item) => item.readAt === null).length,
  }
  emit()
}

export function markRead(id: string): void {
  updateNotification(id, (item) => (item.readAt ? item : { ...item, readAt: Date.now() }))
}

export function dismissNotification(id: string): void {
  updateNotification(id, (item) => ({ ...item, dismissedAt: item.dismissedAt ?? Date.now() }))
}

export function markAllAsRead(): void {
  const now = Date.now()
  state = {
    ...state,
    notifications: state.notifications.map((item) => ({ ...item, readAt: item.readAt ?? now })),
    unreadCount: 0,
  }
  emit()
}

export function clearNotifications(): void {
  state = {
    ...state,
    notifications: [],
    unreadCount: 0,
  }
  emit()
}

export function setDoNotDisturb(enabled: boolean): void {
  state = {
    ...state,
    doNotDisturb: enabled,
  }
  emit()
}

export function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    browserNotificationPermission = 'unsupported'
    emit()
    return Promise.resolve('unsupported')
  }

  if (window.Notification.permission === 'granted' || window.Notification.permission === 'denied') {
    browserNotificationPermission = window.Notification.permission
    emit()
    return Promise.resolve(window.Notification.permission)
  }

  return window.Notification.requestPermission().then((permission) => {
    browserNotificationPermission = permission
    emit()
    return permission
  })
}

export function dispatchNotificationAction(action: NotificationAction): void {
  if (action.kind === 'view-decision' && action.decisionId) {
    window.dispatchEvent(new CustomEvent('dashboard:view-decision', { detail: { decisionId: action.decisionId } }))
    return
  }

  if (action.kind === 'open-url' && action.href) {
    window.open(action.href, '_blank', 'noopener,noreferrer')
    return
  }

  window.dispatchEvent(new CustomEvent('dashboard:notification-action', { detail: action }))
}

export function getNotificationState(): NotificationState {
  return state
}

export function getVisibleToasts(): NotificationItem[] {
  return state.notifications
    .filter((item) => item.dismissedAt === null)
    .filter((item) => state.doNotDisturb ? item.level === 'critical' : true)
    .slice(0, MAX_TOASTS)
}

export function subscribeToNotifications(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const notify = {
  success(message: string, options?: NotificationOptions) {
    return enqueue('success', message, options)
  },
  error(message: string, options?: NotificationOptions) {
    return enqueue('error', message, options)
  },
  warning(message: string, options?: NotificationOptions) {
    return enqueue('warning', message, options)
  },
  critical(message: string, options?: NotificationOptions & { sound?: boolean }) {
    return enqueue('critical', message, { ...options, sound: options?.sound ?? true })
  },
}
