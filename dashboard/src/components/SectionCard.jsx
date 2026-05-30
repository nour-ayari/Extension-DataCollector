import { cn } from '../utils/cn.js'

export function SectionCard({ title, description, actions, children, className = '' }) {
  return (
    <section
      className={cn(
        'min-w-0 overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/85 px-5 py-5 shadow-[var(--page-shadow)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/60 sm:px-6 sm:py-6',
        className,
      )}
    >
      {(title || description || actions) && (
        <div className="mb-5 flex flex-col gap-3 border-b border-slate-200/70 pb-5 sm:flex-row sm:items-start sm:justify-between dark:border-slate-800">
          <div className="space-y-1">
            {title ? <h2 className="text-base font-semibold tracking-tight text-slate-950 dark:text-white">{title}</h2> : null}
            {description ? (
              <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      )}

      {children}
    </section>
  )
}