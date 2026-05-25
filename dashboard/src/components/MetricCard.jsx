import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { formatMetricValue } from '../utils/format.js'
import { cn } from '../utils/cn.js'

const toneClasses = {
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  cyan: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-300',
}

export function MetricCard({ icon: Icon, label, value, format, delta, helper, tone = 'indigo', loading = false }) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-[28px] border border-slate-200/80 bg-white/85 p-5 shadow-[var(--page-shadow)] dark:border-slate-800 dark:bg-slate-950/60">
        <div className="mb-4 h-12 w-12 rounded-2xl bg-slate-200/80 dark:bg-slate-800" />
        <div className="mb-3 h-3 w-32 rounded-full bg-slate-200/80 dark:bg-slate-800" />
        <div className="mb-2 h-10 w-24 rounded-full bg-slate-200/80 dark:bg-slate-800" />
        <div className="h-3 w-40 rounded-full bg-slate-200/80 dark:bg-slate-800" />
      </div>
    )
  }

  const isPositive = typeof delta === 'string' && delta.startsWith('+')
  const isNegative = typeof delta === 'string' && delta.startsWith('-')

  return (
    <article className="group rounded-[28px] border border-slate-200/80 bg-white/85 p-5 shadow-[var(--page-shadow)] transition duration-300 hover:-translate-y-1 dark:border-slate-800 dark:bg-slate-950/60 sm:p-6">
      <div className={cn('mb-5 inline-flex rounded-2xl p-3', toneClasses[tone] || toneClasses.indigo)}>
        {Icon ? <Icon className="h-5 w-5" /> : null}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">{label}</p>
        <div className="flex items-end justify-between gap-3">
          <p className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
            {formatMetricValue(value, format)}
          </p>
          {delta ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
                isPositive && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                isNegative && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                !isPositive && !isNegative && 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300',
              )}
            >
              {isPositive ? <ArrowUpRight className="h-3.5 w-3.5" /> : isNegative ? <ArrowDownRight className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
              {delta}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{helper}</p>
      </div>
    </article>
  )
}