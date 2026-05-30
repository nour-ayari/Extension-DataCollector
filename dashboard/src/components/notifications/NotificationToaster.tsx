import { Bell, CheckCircle2, ExternalLink, TriangleAlert, X } from 'lucide-react'
import { cn } from '../../utils/cn.js'
import { dispatchNotificationAction, type NotificationAction, type NotificationItem } from '../../services/notifications'

export interface NotificationToasterProps {
  notifications: NotificationItem[]
  onDismiss: (id: string) => void
}

const iconMap = {
  success: CheckCircle2,
  error: TriangleAlert,
  warning: Bell,
  critical: TriangleAlert,
} as const

function levelTone(level: NotificationItem['level']): string {
  if (level === 'critical') {
    return 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100'
  }

  if (level === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200'
  }

  if (level === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200'
  }

  return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200'
}

function renderAction(action: NotificationAction) {
  const Icon = action.kind === 'open-url' ? ExternalLink : Bell

  return (
    <button
      key={`${action.kind}-${action.label}`}
      type="button"
      onClick={() => dispatchNotificationAction(action)}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/70 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-white dark:bg-slate-950/70 dark:text-white"
    >
      <Icon className="h-3 w-3" />
      {action.label}
    </button>
  )
}

export function NotificationToaster({ notifications, onDismiss }: NotificationToasterProps) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(96vw,28rem)] flex-col gap-3 sm:right-6 sm:top-6">
      {notifications.map((notification) => {
        const Icon = iconMap[notification.level]

        return (
          <article
            key={notification.id}
            className={cn('pointer-events-auto rounded-[24px] border px-4 py-4 shadow-[0_22px_60px_rgba(15,23,42,0.18)] backdrop-blur-xl transition duration-200 hover:-translate-y-0.5', levelTone(notification.level))}
            role="status"
            aria-live={notification.level === 'critical' ? 'assertive' : 'polite'}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl bg-white/70 p-2 text-slate-950 shadow-sm dark:bg-slate-950/70 dark:text-white">
                <Icon className="h-4 w-4" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] opacity-75">{notification.level}</p>
                    <p className="mt-1 text-sm font-medium leading-6">{notification.message}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDismiss(notification.id)}
                    className="rounded-full p-1 transition hover:bg-white/70 dark:hover:bg-slate-950/70"
                    aria-label="Dismiss notification"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {notification.actions.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {notification.actions.map(renderAction)}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
