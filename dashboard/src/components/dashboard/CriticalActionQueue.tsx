import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Eye, RefreshCcw, Wifi, WifiOff, XCircle } from 'lucide-react'
import { Badge } from '../Badge.jsx'
import { SectionCard } from '../SectionCard'
import { notify } from '../../services/notifications'
import { useAllDecisions } from '../../hooks/useDecisions'
import { useDecisionWebSocket } from '../../hooks/useWebSocket'
import { cn } from '../../utils/cn.js'
import { formatConfidence } from '../../utils/format.js'
import {
  formatActionType,
  getDecisionActionType,
  getDecisionKey,
  getDecisionTimestamp,
  getDecisionUrgency,
  mergeDecisions,
} from '../../utils/decision'
import type { ActionUrgency, DashboardDateRange, DecisionFilters, DecisionRecord } from '../../types/api'

export interface CriticalActionQueueProps {
  dateRange?: DashboardDateRange
  filters?: DecisionFilters
  onDecisionSelect?: (decisionId: string) => void
}

const POLLING_FALLBACK_MS = 5000
const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function formatActionTypeLabel(actionType?: string): string {
  if (!actionType) {
    return 'Unknown Action'
  }

  return formatActionType(actionType)
}

function formatRelativeTime(value?: string): string {
  if (!value) {
    return 'Just now'
  }

  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    return 'Just now'
  }

  const deltaSeconds = Math.round((timestamp.getTime() - Date.now()) / 1000)
  const absSeconds = Math.abs(deltaSeconds)

  if (absSeconds < 45) {
    return deltaSeconds <= 0 ? 'Just now' : 'In a few seconds'
  }

  const units: Array<{ limit: number; div: number; unit: Intl.RelativeTimeFormatUnit }> = [
    { limit: 60, div: 1, unit: 'second' },
    { limit: 3600, div: 60, unit: 'minute' },
    { limit: 86_400, div: 3600, unit: 'hour' },
    { limit: 2_592_000, div: 86_400, unit: 'day' },
    { limit: 31_104_000, div: 2_592_000, unit: 'month' },
    { limit: Number.POSITIVE_INFINITY, div: 31_104_000, unit: 'year' },
  ]

  const selectedUnit = units.find((entry) => absSeconds < entry.limit) ?? units[units.length - 1]
  const valueInUnit = Math.round(deltaSeconds / selectedUnit.div)

  return relativeTimeFormatter.format(valueInUnit, selectedUnit.unit)
}

function getDateRangeStart(dateRange: DashboardDateRange): Date {
  const start = new Date()

  if (dateRange === 'today') {
    start.setHours(0, 0, 0, 0)
    return start
  }

  if (dateRange === '7d') {
    start.setDate(start.getDate() - 7)
    return start
  }

  start.setDate(start.getDate() - 30)
  return start
}

function getDecisionScore(decision: DecisionRecord): number {
  const confidence = decision.confidence ?? 0
  return confidence <= 1 ? confidence * 100 : confidence
}

function sortDecisions(decisions: DecisionRecord[]): DecisionRecord[] {
  return [...decisions].sort((left, right) => {
    const leftUrgency = getDecisionUrgency(left)
    const rightUrgency = getDecisionUrgency(right)

    if (leftUrgency !== rightUrgency) {
      return leftUrgency === 'critical' ? -1 : 1
    }

    const leftTime = new Date(getDecisionTimestamp(left) ?? 0).getTime()
    const rightTime = new Date(getDecisionTimestamp(right) ?? 0).getTime()

    return rightTime - leftTime
  })
}

function urgencyTone(urgency: ActionUrgency): string {
  if (urgency === 'critical') {
    return 'bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20 dark:text-rose-300'
  }

  return 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300'
}

function mergeAndSortDecisions(...groups: DecisionRecord[][]): DecisionRecord[] {
  return sortDecisions(mergeDecisions(...groups))
}

function playVipTone(): void {
  try {
    const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (!AudioContextConstructor) {
      return
    }

    const audioContext = new AudioContextConstructor()
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gainNode.gain.value = 0.03

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start()

    window.setTimeout(() => {
      oscillator.frequency.setValueAtTime(660, audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.18)
      window.setTimeout(() => {
        void audioContext.close()
      }, 250)
    }, 90)
  } catch {
    // Optional audio feedback only.
  }
}

export function CriticalActionQueue({ dateRange = 'today', filters, onDecisionSelect }: CriticalActionQueueProps) {
  const decisionFilters = useMemo(
    () => ({
      ...filters,
      urgency: filters?.urgency ?? ['critical', 'high'],
    }),
    [filters],
  )

  const { data: initialDecisions = [], isLoading, error, refetch } = useAllDecisions(decisionFilters)
  const { latestEvent, connectionStatus } = useDecisionWebSocket()
  const [decisions, setDecisions] = useState<DecisionRecord[]>([])

  useEffect(() => {
    setDecisions((current) => mergeAndSortDecisions(initialDecisions, current))
  }, [initialDecisions])

  useEffect(() => {
    if (!latestEvent || latestEvent.type !== 'new_decision') {
      return
    }

    const incomingDecision = latestEvent.data
    const urgency = getDecisionUrgency(incomingDecision)
    const isCriticalOrHigh = urgency === 'critical' || urgency === 'high'
    const decisionId = incomingDecision.id ?? incomingDecision.decision_id

    setDecisions((current) => mergeAndSortDecisions(current, [incomingDecision]))

    if (!isCriticalOrHigh) {
      return
    }

    const decisionLabel = formatActionTypeLabel(incomingDecision.action_type ?? incomingDecision.action?.action_type)
    const toastPrefix = urgency === 'critical' ? 'Critical decision' : 'High-priority decision'

    const notifyOptions = {
      source: 'critical-queue',
      sound: urgency === 'critical',
      metadata: { vip: incomingDecision.persona === 'VIP' },
      actions: decisionId
        ? [
            {
              label: 'View decision',
              kind: 'view-decision' as const,
              decisionId,
            },
          ]
        : [],
    }

    if (urgency === 'critical') {
      notify.critical(`${toastPrefix} arrived for ${incomingDecision.user_id}: ${decisionLabel}`, notifyOptions)
    } else {
      notify.warning(`${toastPrefix} arrived for ${incomingDecision.user_id}: ${decisionLabel}`, notifyOptions)
    }

    if (incomingDecision.persona === 'VIP' && urgency === 'critical') {
      playVipTone()
    }
  }, [latestEvent])

  useEffect(() => {
    if (connectionStatus !== 'disconnected') {
      return
    }

    const intervalId = window.setInterval(() => {
      void refetch()
    }, POLLING_FALLBACK_MS)

    return () => window.clearInterval(intervalId)
  }, [connectionStatus, refetch])

  const visibleDecisions = useMemo(
    () =>
      sortDecisions(decisions).filter((decision) => {
        const urgency = getDecisionUrgency(decision)
        const timestamp = getDecisionTimestamp(decision)

        return (
          (urgency === 'critical' || urgency === 'high') &&
          (!timestamp || new Date(timestamp).getTime() >= getDateRangeStart(dateRange).getTime())
        )
      }),
    [dateRange, decisions],
  )

  const statusTone =
    connectionStatus === 'connected'
      ? 'success'
      : connectionStatus === 'reconnecting'
        ? 'warning'
        : 'danger'

  const statusLabel =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'reconnecting'
        ? 'Reconnecting'
        : 'Disconnected'

  return (
    <SectionCard
      title="Critical Action Queue"
      description="High-priority AI decisions that need immediate review."
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone} className="gap-2">
            {connectionStatus === 'connected' ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {statusLabel}
          </Badge>

          <button
            type="button"
            onClick={() => {
              void refetch()
            }}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3 text-sm text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', connectionStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : connectionStatus === 'reconnecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500 animate-pulse')} />
          <span>
            {connectionStatus === 'connected'
              ? 'Live WebSocket updates enabled'
              : connectionStatus === 'reconnecting'
                ? 'Reconnecting to live updates'
                : 'Polling fallback active'}
          </span>
        </div>
        <span>{visibleDecisions.length} items</span>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="animate-pulse rounded-[24px] border border-slate-200/80 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/40"
            >
              <div className="mb-4 h-11 w-11 rounded-2xl bg-slate-200 dark:bg-slate-800" />
              <div className="mb-3 h-4 w-3/5 rounded-full bg-slate-200 dark:bg-slate-800" />
              <div className="mb-2 h-3 w-2/3 rounded-full bg-slate-200 dark:bg-slate-800" />
              <div className="h-3 w-full rounded-full bg-slate-200 dark:bg-slate-800" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
          Unable to load critical actions. Please try again.
        </div>
      ) : visibleDecisions.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-emerald-200 bg-emerald-50 px-5 py-8 text-center text-sm font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
          No critical actions required ✓
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleDecisions.map((decision) => {
            const urgency = getDecisionUrgency(decision)
            const timestamp = getDecisionTimestamp(decision) || undefined
            const actionType = getDecisionActionType(decision)
            const decisionId = decision.id ?? decision.decision_id ?? ''

            return (
              <article
                key={getDecisionKey(decision)}
                className="group rounded-[24px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(15,23,42,0.1)] dark:border-slate-800 dark:bg-slate-950/70"
                onClick={() => {
                  if (decisionId) {
                    onDecisionSelect?.(decisionId)
                  }
                }}
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className={cn('inline-flex rounded-2xl p-3', urgencyTone(urgency))}>
                    <AlertTriangle className="h-5 w-5" />
                  </div>

                  <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em]', urgencyTone(urgency))}>
                    {urgency}
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">User ID</p>
                    <p className="truncate text-base font-semibold text-slate-950 dark:text-white" title={decision.user_id}>
                      {decision.user_id}
                    </p>
                  </div>

                  <div className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500 dark:text-slate-400">Action</span>
                      <span className="font-medium text-slate-950 dark:text-white">{formatActionTypeLabel(String(actionType))}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500 dark:text-slate-400">Persona</span>
                      <span className="font-medium text-slate-950 dark:text-white">{decision.persona}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500 dark:text-slate-400">Sentiment</span>
                      <span className="font-medium text-slate-950 dark:text-white">{decision.sentiment}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500 dark:text-slate-400">Confidence</span>
                      <span className="font-medium text-slate-950 dark:text-white">{formatConfidence(getDecisionScore(decision) / 100)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500 dark:text-slate-400">Updated</span>
                      <span className="font-medium text-slate-950 dark:text-white" title={timestamp ? new Date(timestamp).toLocaleString() : undefined}>
                        {formatRelativeTime(timestamp)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (decisionId) {
                          onDecisionSelect?.(decisionId)
                        }
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-white"
                    >
                      <Eye className="h-4 w-4" />
                      View Details
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        notify.success('Decision acknowledged successfully', { source: 'critical-queue' })
                        if (decisionId) {
                          onDecisionSelect?.(decisionId)
                        }
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Acknowledge
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        notify.warning('Decision dismissed from the critical queue', { source: 'critical-queue' })
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-rose-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-500"
                    >
                      <XCircle className="h-4 w-4" />
                      Dismiss
                    </button>
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

export default CriticalActionQueue
