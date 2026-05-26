import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Download, Wifi } from 'lucide-react'
import { SectionCard } from '../SectionCard'
import { useAllDecisions } from '../../hooks/useDecisions'
import { useDecisionWebSocket } from '../../hooks/useWebSocket'
import { cn } from '../../utils/cn.js'
import {
  formatActionType,
  getDecisionActionType,
  getDecisionKey,
  getDecisionTimestamp,
  getDecisionUrgency,
  isConverted,
  mergeDecisions,
} from '../../utils/decision'
import type { ActionUrgency, DashboardDateRange, DecisionFilters, DecisionRecord } from '../../types/api'
import type { HeatmapSelection } from './Heatmap'

type UrgencyFilter = 'all' | ActionUrgency
export type { DashboardDateRange }

export interface ActivityStreamProps {
  selection?: HeatmapSelection | null
  dateRange?: DashboardDateRange
  urgencyFilter?: UrgencyFilter
  onUrgencyFilterChange?: (value: UrgencyFilter) => void
  onDecisionSelect?: (decisionId: string) => void
  filters?: DecisionFilters
}

const MAX_ITEMS = 20
const POLLING_FALLBACK_MS = 10_000

function getFilterStart(dateRange: DashboardDateRange): number {
  const start = new Date()

  if (dateRange === 'today') {
    start.setHours(0, 0, 0, 0)
  } else if (dateRange === '7d') {
    start.setDate(start.getDate() - 7)
  } else {
    start.setDate(start.getDate() - 30)
  }

  return start.getTime()
}

function decisionDescription(decision: DecisionRecord): string {
  return decision.recommendation ?? decision.reasoning ?? decision.description ?? decision.action?.description ?? 'No description available'
}

function statusLabel(decision: DecisionRecord): string {
  const status = decision.status?.trim().toLowerCase()

  if (isConverted(decision) || status === 'complete') {
    return 'Completed'
  }

  if (status === 'failed' || status === 'error' || status === 'rejected') {
    return 'Failed'
  }

  if (status === 'pending' || status === 'queued' || status === 'waiting') {
    return 'Pending'
  }

  return 'Fired'
}

function confidencePercent(decision: DecisionRecord): number {
  const value = decision.confidence ?? 0
  return value <= 1 ? Math.round(value * 100) : Math.round(value)
}

function csvEscape(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function downloadCsv(fileName: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ActivityStream({
  selection = null,
  dateRange = 'today',
  urgencyFilter: controlledUrgencyFilter,
  onUrgencyFilterChange,
  onDecisionSelect,
  filters,
}: ActivityStreamProps) {
  const { data: initialDecisions = [], isLoading, error, refetch } = useAllDecisions(filters)
  const { latestEvent, connectionStatus } = useDecisionWebSocket()
  const [internalUrgencyFilter, setInternalUrgencyFilter] = useState<UrgencyFilter>('all')
  const [decisions, setDecisions] = useState<DecisionRecord[]>([])
  const [hasNewActivity, setHasNewActivity] = useState(false)
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const previousTopKeyRef = useRef<string | null>(null)
  const urgencyFilter = controlledUrgencyFilter ?? internalUrgencyFilter

  useEffect(() => {
    setDecisions((current) => mergeDecisions(initialDecisions, current))
  }, [initialDecisions])

  useEffect(() => {
    if (!latestEvent || latestEvent.type !== 'new_decision') {
      return
    }

    setDecisions((current) => mergeDecisions([latestEvent.data], current))
    setHasNewActivity(true)
  }, [latestEvent])

  useEffect(() => {
    if (connectionStatus !== 'disconnected') {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      void refetch()
    }, POLLING_FALLBACK_MS)

    return () => window.clearInterval(intervalId)
  }, [connectionStatus, refetch])

  const visibleDecisions = useMemo(() => {
    return decisions
      .filter((decision) => urgencyFilter === 'all' || getDecisionUrgency(decision) === urgencyFilter)
      .filter((decision) => {
        const timestamp = getDecisionTimestamp(decision)
        return timestamp ? new Date(timestamp).getTime() >= getFilterStart(dateRange) : false
      })
      .filter((decision) => {
        if (!selection) {
          return true
        }

        return (!selection.persona || decision.persona === selection.persona) && (!selection.sentiment || decision.sentiment === selection.sentiment)
      })
      .sort((left, right) => new Date(getDecisionTimestamp(right) || 0).getTime() - new Date(getDecisionTimestamp(left) || 0).getTime())
      .slice(0, MAX_ITEMS)
  }, [dateRange, decisions, selection, urgencyFilter])

  const topKey = visibleDecisions[0] ? getDecisionKey(visibleDecisions[0]) : null

  useEffect(() => {
    if (!topKey) {
      previousTopKeyRef.current = null
      return
    }

    const previousTopKey = previousTopKeyRef.current
    previousTopKeyRef.current = topKey

    if (previousTopKey === null || previousTopKey === topKey) {
      return
    }

    setHighlightedKey(topKey)
    setHasNewActivity(true)

    window.requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    })

    const timeoutId = window.setTimeout(() => {
      setHighlightedKey(null)
    }, 1200)

    return () => window.clearTimeout(timeoutId)
  }, [topKey])

  const handleExportCsv = () => {
    const rows = [
      ['timestamp', 'urgency', 'action_type', 'persona', 'sentiment', 'status', 'user_id', 'description'],
      ...visibleDecisions.map((decision) => [
        getDecisionTimestamp(decision),
        getDecisionUrgency(decision),
        formatActionType(String(getDecisionActionType(decision))),
        decision.persona,
        decision.sentiment,
        statusLabel(decision),
        decision.user_id,
        decisionDescription(decision),
      ]),
    ]

    downloadCsv(`activity-stream-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.csv`, rows)
  }

  const connectionTone = connectionStatus === 'connected' ? 'success' : connectionStatus === 'reconnecting' ? 'warning' : 'danger'

  return (
    <SectionCard
      title="Activity Stream"
      description="Live feed of the latest AI decisions and their delivery status."
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative inline-flex items-center">
            <span className="sr-only">Filter by urgency level</span>
            <select
              value={urgencyFilter}
              onChange={(event) => {
                const nextValue = event.target.value as UrgencyFilter
                if (onUrgencyFilterChange) {
                  onUrgencyFilterChange(nextValue)
                } else {
                  setInternalUrgencyFilter(nextValue)
                }
              }}
              className="h-10 rounded-full border border-slate-200 bg-white px-3 pr-9 text-sm font-medium text-slate-700 shadow-sm outline-none transition hover:border-slate-300 focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300"
            >
              <option value="all">All urgencies</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-3.5 text-sm font-medium text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      )}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', connectionStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : connectionStatus === 'reconnecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500 animate-pulse')} />
          <span>{connectionStatus === 'connected' ? 'Live WebSocket updates enabled' : connectionStatus === 'reconnecting' ? 'Reconnecting to live updates' : 'Polling fallback active'}</span>
        </div>

        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em]">
          <Activity className="h-4 w-4" />
          <span>{visibleDecisions.length} shown</span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {hasNewActivity ? (
          <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300">
            New activity
          </span>
        ) : null}
        <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold', connectionTone === 'success' ? 'bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300' : connectionTone === 'warning' ? 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300' : 'bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20 dark:text-rose-300')}>
          {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'reconnecting' ? 'Reconnecting' : 'Disconnected'}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-[20px] border border-slate-200/80 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
          Unable to load activity stream right now.
        </div>
      ) : visibleDecisions.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
          No decisions match the selected filters.
        </div>
      ) : (
        <div
          ref={listRef}
          onScroll={() => setHasNewActivity(false)}
          className="max-h-[34rem] space-y-2 overflow-auto pr-1 [scrollbar-width:thin] [scrollbar-color:theme(colors.slate.300)_transparent] dark:[scrollbar-color:theme(colors.slate.700)_transparent]"
        >
          {visibleDecisions.map((decision) => {
            const rowKey = getDecisionKey(decision)
            const decisionId = decision.id ?? decision.decision_id

            return (
              <article
                key={rowKey}
                className={cn(
                  'grid gap-3 rounded-[20px] border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[0_10px_32px_rgba(15,23,42,0.05)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_42px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-950/70 md:grid-cols-[10rem_minmax(0,1fr)_10rem] md:items-center',
                  highlightedKey === rowKey && 'ring-1 ring-indigo-500/30',
                )}
                onClick={() => {
                  if (decisionId) {
                    onDecisionSelect?.(decisionId)
                  }
                }}
              >
                <div className="flex items-center gap-3 md:min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-500/10 text-slate-700 dark:text-slate-300">
                    <Wifi className="h-5 w-5" />
                  </div>

                  <div className="min-w-0">
                    <div className="font-mono text-sm tabular-nums text-slate-700 dark:text-slate-300">{new Date(getDecisionTimestamp(decision)).toLocaleTimeString('en-GB', { hour12: false })}</div>
                    <div className="truncate text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400" title={decision.user_id}>
                      {decision.user_id}
                    </div>
                  </div>
                </div>

                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em]', getDecisionUrgency(decision) === 'critical' ? 'bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20 dark:text-rose-300' : getDecisionUrgency(decision) === 'high' ? 'bg-orange-500/10 text-orange-700 ring-1 ring-inset ring-orange-500/20 dark:text-orange-300' : getDecisionUrgency(decision) === 'medium' ? 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300' : 'bg-slate-500/10 text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-slate-300')}>
                      {getDecisionUrgency(decision)}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      {formatActionType(String(getDecisionActionType(decision)))}
                    </span>
                  </div>

                  <p className="truncate text-sm leading-6 text-slate-600 dark:text-slate-300" title={decisionDescription(decision)}>
                    {decisionDescription(decision)}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 md:justify-end">
                  <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', statusLabel(decision) === 'Completed' ? 'bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300' : statusLabel(decision) === 'Pending' ? 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300' : statusLabel(decision) === 'Failed' ? 'bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20 dark:text-rose-300' : 'bg-blue-500/10 text-blue-700 ring-1 ring-inset ring-blue-500/20 dark:text-blue-300')}>
                    {statusLabel(decision)}
                  </span>

                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 md:justify-self-end">
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      {confidencePercent(decision)}% confidence
                    </span>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

export default ActivityStream
