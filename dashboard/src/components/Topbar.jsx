import { Menu } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle.jsx'

export function Topbar({ title, subtitle, onMenuClick, rightActions }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/75 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/75">
      <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6 xl:px-10">
        <button
          type="button"
          onClick={onMenuClick}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-400 dark:text-slate-500">
            {title}
          </p>
          <h2 className="text-base font-semibold tracking-tight text-slate-950 dark:text-white sm:text-lg">
            {subtitle}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {rightActions}
        </div>

        <ThemeToggle />
      </div>
    </header>
  )
}