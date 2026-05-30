import { cn } from '../utils/cn.js'

export function PageHeader({ eyebrow, title, description, actions, className = '' }) {
  return (
    <header className={cn('flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between', className)}>
      <div className="space-y-2">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">
            {eyebrow}
          </p>
        ) : null}
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
            {title}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400 sm:text-base">
            {description}
          </p>
        </div>
      </div>

      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  )
}