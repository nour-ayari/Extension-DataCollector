import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NotificationToaster } from './NotificationToaster'
import {
  clearNotifications,
  dismissNotification,
  getNotificationState,
  getVisibleToasts,
  markAllAsRead,
  markRead,
  notify,
  requestBrowserNotificationPermission,
  setDoNotDisturb,
  subscribeToNotifications,
  type NotificationItem,
  type NotificationState,
} from '../../services/notifications'

export interface NotificationCenterContextValue {
  notifications: NotificationItem[]
  unreadCount: number
  doNotDisturb: boolean
  browserPermission: NotificationState['browserPermission']
  markAllAsRead: () => void
  clearAll: () => void
  markRead: (id: string) => void
  dismiss: (id: string) => void
  setDoNotDisturb: (enabled: boolean) => void
  requestBrowserPermission: () => Promise<NotificationState['browserPermission']>
}

const NotificationCenterContext = createContext<NotificationCenterContextValue | null>(null)

function subscribe(listener: () => void) {
  return subscribeToNotifications(listener)
}

function getSnapshot() {
  return getNotificationState()
}

function getServerSnapshot() {
  return getNotificationState()
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const toastItems = useMemo(() => getVisibleToasts(), [snapshot.notifications, snapshot.doNotDisturb, snapshot.unreadCount, snapshot.browserPermission])
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    let container = containerRef.current
    if (!container) {
      container = document.createElement('div')
      container.setAttribute('data-notification-portal', 'true')
      document.body.appendChild(container)
      containerRef.current = container
    }

    return () => {
      if (containerRef.current && containerRef.current.parentNode) {
        containerRef.current.parentNode.removeChild(containerRef.current)
        containerRef.current = null
      }
    }
  }, [])

  const contextValue: NotificationCenterContextValue = {
    notifications: snapshot.notifications,
    unreadCount: snapshot.unreadCount,
    doNotDisturb: snapshot.doNotDisturb,
    browserPermission: snapshot.browserPermission,
    markAllAsRead,
    clearAll: clearNotifications,
    markRead,
    dismiss: dismissNotification,
    setDoNotDisturb,
    requestBrowserPermission: requestBrowserNotificationPermission,
  }

  return (
    <NotificationCenterContext.Provider value={contextValue}>
      {children}
      {containerRef.current ? createPortal(<NotificationToaster notifications={toastItems} onDismiss={dismissNotification} />, containerRef.current) : null}
    </NotificationCenterContext.Provider>
  )
}

export function useNotifications() {
  const value = useContext(NotificationCenterContext)
  if (!value) {
    throw new Error('useNotifications must be used within NotificationProvider')
  }

  return value
}

export { notify }
