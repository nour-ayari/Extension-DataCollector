import { Menu, Search } from 'lucide-react'
import { Badge } from './Badge.jsx'
import { ThemeToggle } from './ThemeToggle.jsx'

export function Topbar({ title, subtitle, onMenuClick, apiHealth }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/75 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/75">
      <div className="flex items-center gap-4 px-4 py-4 sm:px-6 xl:px-10">
        <button
          type="button"
          onClick={onMenuClick}
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500 dark:text-slate-400">
            {title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-2xl">
              {subtitle}
            </h2>
            {apiHealth.status ? (
              <Badge
                tone={apiHealth.status === 'connected' ? 'success' : apiHealth.status === 'offline' ? 'danger' : 'info'}
                className="hidden sm:inline-flex"
              >
                {apiHealth.status === 'connected'
                  ? 'API connected'
                  : apiHealth.status === 'offline'
                    ? 'API offline'
                    : apiHealth.status === 'checking'
                      ? 'Checking API'
                      : 'Mock API'}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="hidden min-w-[260px] items-center rounded-2xl border border-slate-200 bg-white/85 px-3 py-2 text-sm text-slate-400 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 xl:flex">
          <Search className="mr-2 h-4 w-4" />
          Search users, actions, or segments
        </div>

        <ThemeToggle />
      </div>
    </header>
  )
}