import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, BellRing, CheckCheck, MoonStar, Trash2, X } from 'lucide-react'
import { Badge } from '../Badge.jsx'
import { cn } from '../../utils/cn.js'
import { dispatchNotificationAction, type NotificationItem } from '../../services/notifications'
import { useNotifications } from './NotificationProvider'

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function levelTone(level: NotificationItem['level']): string {
  if (level === 'critical') return 'danger'
  if (level === 'error') return 'danger'
  if (level === 'warning') return 'warning'
  if (level === 'success') return 'success'
  return 'info'
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const { notifications, unreadCount, doNotDisturb, browserPermission, markAllAsRead, clearAll, markRead, dismiss, setDoNotDisturb, requestBrowserPermission } = useNotifications()

  const recentNotifications = useMemo(() => notifications.slice(0, 50), [notifications])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    if (open) {
      markAllAsRead()
    }
  }, [open, markAllAsRead])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open notifications"
      >
        {doNotDisturb ? <BellOff className="h-5 w-5" /> : unreadCount > 0 ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notification center"
          className="absolute right-0 top-14 z-50 w-[min(92vw,24rem)] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] dark:border-slate-800 dark:bg-slate-950"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 px-4 py-4 dark:border-slate-800">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">Notifications</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Recent alerts and decision activity</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-900 dark:hover:text-white" aria-label="Close notification center">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => markAllAsRead()}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300"
            >
              <CheckCheck className="h-4 w-4" />
              Mark all as read
            </button>
            <button
              type="button"
              onClick={() => clearAll()}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
            >
              <Trash2 className="h-4 w-4" />
              Clear all
            </button>
          </div>

          <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={doNotDisturb ? 'warning' : 'neutral'} className="gap-2">
                <MoonStar className="h-3.5 w-3.5" />
                Do Not Disturb {doNotDisturb ? 'On' : 'Off'}
              </Badge>
              <button
                type="button"
                onClick={() => setDoNotDisturb(!doNotDisturb)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300"
              >
                Toggle DND
              </button>
              <button
                type="button"
                onClick={() => void requestBrowserPermission()}
                className={cn('rounded-full px-3 py-1.5 text-xs font-semibold transition', browserPermission === 'granted' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300')}
              >
                Browser notifications {browserPermission === 'granted' ? 'enabled' : 'permission'}
              </button>
            </div>
          </div>

          <div className="max-h-[32rem] overflow-auto px-2 py-2">
            {recentNotifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No notifications yet.</div>
            ) : (
              <div className="space-y-2">
                {recentNotifications.map((notification) => (
                  <article
                    key={notification.id}
                    className={cn(
                      'rounded-2xl border px-3 py-3 transition hover:-translate-y-0.5',
                      notification.readAt ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/60' : 'border-indigo-200 bg-indigo-50/80 dark:border-indigo-900/40 dark:bg-indigo-950/20',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge tone={levelTone(notification.level)}>{notification.level}</Badge>
                          <span className="text-[11px] font-mono text-slate-400">{formatTime(notification.createdAt)}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{notification.message}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => dismiss(notification.id)}
                        className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-900 dark:hover:text-white"
                        aria-label="Dismiss notification"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {notification.actions.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {notification.actions.map((action) => (
                          <button
                            key={`${notification.id}-${action.kind}-${action.label}`}
                            type="button"
                            onClick={() => {
                              markRead(notification.id)
                              dispatchNotificationAction(action)
                              setOpen(false)
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300"
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
