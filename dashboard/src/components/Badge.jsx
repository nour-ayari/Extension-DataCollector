import { cn } from '../utils/cn.js'

const toneClasses = {
  neutral: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
  muted: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400',
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  info: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  accent: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
}

export function Badge({ tone = 'neutral', className = '', children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide',
        toneClasses[tone] || toneClasses.neutral,
        className,
      )}
    >
      {children}
    </span>
  )
}