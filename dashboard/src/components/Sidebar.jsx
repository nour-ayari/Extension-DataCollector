import { BarChart3, LayoutDashboard, MessageSquareMore, Settings2, Sparkles, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { Badge } from './Badge.jsx'
import { cn } from '../utils/cn.js'

const navigation = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
  { label: 'Overview', to: '/overview', icon: BarChart3 },
  { label: 'Feedback', to: '/feedback', icon: MessageSquareMore },
  { label: 'Settings', to: '/settings', icon: Settings2 },
]

export function Sidebar({ open, onClose, apiHealth }) {
  return (
    <>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 -translate-x-full flex-col border-r border-slate-200/80 bg-white/90 px-5 py-6 backdrop-blur-xl transition-transform duration-300 dark:border-slate-800 dark:bg-slate-950/90 lg:translate-x-0',
          open && 'translate-x-0',
        )}
      >
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-indigo-700 dark:text-indigo-300">
              <Sparkles className="h-4 w-4" />
              Agent 3
            </div>
            <div>
              <h1 className="text-xl font-semibold leading-tight text-slate-950 dark:text-white">
                Recommendation
                <br />
                Intelligence
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                A modern SaaS-style dashboard for recommendation and feedback workflows.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-700 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="space-y-2">
          {navigation.map((item) => {
            const Icon = item.icon

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium transition duration-200',
                    isActive
                      ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-700 shadow-sm dark:text-indigo-300'
                      : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:border-slate-800 dark:hover:bg-slate-900/70',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <div className="mt-auto space-y-4 rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
              Connection status
            </p>
            <Badge tone={apiHealth.status === 'connected' ? 'success' : apiHealth.status === 'offline' ? 'danger' : apiHealth.status === 'checking' ? 'info' : 'muted'} className="w-fit">
              {apiHealth.status === 'connected'
                ? 'Connected'
                : apiHealth.status === 'offline'
                  ? 'Offline'
                  : apiHealth.status === 'checking'
                    ? 'Checking'
                      : 'Not configured'}
            </Badge>
          </div>

          <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{apiHealth.message}</p>
          <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {apiHealth.baseUrl}
          </div>
        </div>
      </aside>

      {open ? (
        <button
          type="button"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
          aria-label="Close navigation overlay"
        />
      ) : null}
    </>
  )
}