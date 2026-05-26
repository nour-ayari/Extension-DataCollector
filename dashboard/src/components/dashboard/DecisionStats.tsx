import { useId, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, Clock3, Gauge, Percent, PieChart as PieChartIcon, Timer, TrendingUp } from 'lucide-react'
import { Badge } from '../Badge.jsx'
import { MetricCard } from '../MetricCard.jsx'
import { SectionCard } from '../SectionCard'
import { ChartSkeleton, MetricCardSkeleton } from '../Skeletons.jsx'
import { cn } from '../../utils/cn.js'
import { formatConfidence, formatMetricValue } from '../../utils/format.js'
import {
  formatActionType,
  getDecisionActionType,
  getDecisionTimestamp,
  getDecisionUrgency,
  isConverted,
} from '../../utils/decision'
import type { ActionType, ActionUrgency, DecisionRecord } from '../../types/api'

export type StatsPeriod = '24h' | '7d' | '30d' | 'custom'

export interface DecisionStatsProps {
  decisions: DecisionRecord[]
  isLoading?: boolean
  className?: string
}

type RangeWindow = {
  start: number
  end: number
  label: string
  bucketCount: number
}

type ActionSuccessRow = {
  actionType: string
  currentRate: number
  previousRate: number
  currentCount: number
  previousCount: number
}

type TrendRow = {
  label: string
  currentConfidence: number | null
  previousConfidence: number | null
}

type UrgencyStackRow = {
  period: 'Current' | 'Previous'
  critical: number
  high: number
  medium: number
  low: number
}

type PieSlice = {
  name: string
  value: number
  percentage: number
}

type AcknowledgedDecision = DecisionRecord & {
  acknowledged_at?: string
  acknowledgedAt?: string
  acknowledgement_at?: string
  acknowledgementAt?: string
  ack_at?: string
  ackAt?: string
  ack_time?: string
  ackTime?: string
  acknowledged_on?: string
  acknowledged_ts?: string
}

const PERIOD_OPTIONS: Array<{ value: StatsPeriod; label: string }> = [
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7d' },
  { value: '30d', label: 'Last 30d' },
  { value: 'custom', label: 'Custom' },
]

const URGENCY_ORDER: ActionUrgency[] = ['critical', 'high', 'medium', 'low']
const ACTION_PALETTE = ['#4f46e5', '#06b6d4', '#f59e0b', '#10b981', '#f43f5e']
const URGENCY_COLORS: Record<ActionUrgency, string> = {
  critical: '#f43f5e',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#64748b',
}

const tooltipStyle = {
  borderRadius: 20,
  border: '1px solid rgba(148,163,184,0.18)',
  background: 'rgba(15,23,42,0.97)',
  color: '#fff',
}

const legendStyle = {
  color: '#64748b',
}

function getTimestamp(decision: DecisionRecord): number {
  const source = getDecisionTimestamp(decision)
  const parsed = new Date(source).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function getAcknowledgementTimestamp(decision: DecisionRecord): number | null {
  const record = decision as AcknowledgedDecision
  const candidates = [
    record.acknowledged_at,
    record.acknowledgedAt,
    record.acknowledgement_at,
    record.acknowledgementAt,
    record.ack_at,
    record.ackAt,
    record.ack_time,
    record.ackTime,
    record.acknowledged_on,
    record.acknowledged_ts,
  ]

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    const parsed = new Date(candidate).getTime()
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  const updatedAt = decision.updated_at ? new Date(decision.updated_at).getTime() : Number.NaN
  return Number.isNaN(updatedAt) ? null : updatedAt
}


function formatMinutes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '--'
  }

  if (value < 1) {
    return '<1m'
  }

  if (value < 60) {
    return `${value.toFixed(1)}m`
  }

  const hours = Math.floor(value / 60)
  const minutes = Math.round(value % 60)
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '--'
  }

  return formatConfidence(value / 100)
}

function parseDateInput(value: string): number | null {
  if (!value) {
    return null
  }

  const parsed = new Date(`${value}T00:00:00`)
  const time = parsed.getTime()
  return Number.isNaN(time) ? null : time
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function getPeriodWindow(period: StatsPeriod, customStart: string, customEnd: string): RangeWindow | null {
  const now = Date.now()
  const durations: Record<Exclude<StatsPeriod, 'custom'>, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }

  if (period === 'custom') {
    const start = parseDateInput(customStart)
    const end = parseDateInput(customEnd)

    if (start === null || end === null || end < start) {
      return null
    }

    return {
      start,
      end: end + (24 * 60 * 60 * 1000 - 1),
      label: `${customStart} → ${customEnd}`,
      bucketCount: getBucketCountFromDuration(end + (24 * 60 * 60 * 1000 - 1) - start),
    }
  }

  const duration = durations[period]
  const end = now
  const start = now - duration
  return {
    start,
    end,
    label: PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? period,
    bucketCount: getBucketCountFromDuration(duration),
  }
}

function getBucketCountFromDuration(durationMs: number): number {
  const days = durationMs / (24 * 60 * 60 * 1000)

  if (days <= 1) {
    return 24
  }

  if (days <= 8) {
    return Math.max(7, Math.round(days))
  }

  if (days <= 14) {
    return 14
  }

  if (days <= 30) {
    return 10
  }

  return 12
}

function isWithinRange(decision: DecisionRecord, range: RangeWindow): boolean {
  const timestamp = getTimestamp(decision)
  return timestamp >= range.start && timestamp <= range.end
}

function getPreviousWindow(current: RangeWindow): RangeWindow {
  const duration = current.end - current.start
  return {
    start: current.start - duration,
    end: current.start - 1,
    label: 'Previous period',
    bucketCount: current.bucketCount,
  }
}

function getCurrentAndPrevious(decisions: DecisionRecord[], current: RangeWindow, previous: RangeWindow): { current: DecisionRecord[]; previous: DecisionRecord[] } {
  return {
    current: decisions.filter((decision) => isWithinRange(decision, current)),
    previous: decisions.filter((decision) => isWithinRange(decision, previous)),
  }
}

function averageConfidence(decisions: DecisionRecord[]): number | null {
  const values = decisions.map((decision) => decision.confidence).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function averageResponseTimeMinutes(decisions: DecisionRecord[]): number | null {
  const values = decisions
    .map((decision) => {
      const acknowledgedAt = getAcknowledgementTimestamp(decision)
      const createdAt = getTimestamp(decision)

      if (!acknowledgedAt || acknowledgedAt < createdAt) {
        return null
      }

      return (acknowledgedAt - createdAt) / 60000
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)

  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function countInRange(decisions: DecisionRecord[], start: number, end: number): number {
  return decisions.filter((decision) => {
    const timestamp = getTimestamp(decision)
    return timestamp >= start && timestamp <= end
  }).length
}

function computeSummary(current: DecisionRecord[], previous: DecisionRecord[]): {
  currentTotal: number
  previousTotal: number
  currentSuccessRate: number | null
  previousSuccessRate: number | null
  currentAvgConfidence: number | null
  previousAvgConfidence: number | null
  currentAvgResponseTime: number | null
  previousAvgResponseTime: number | null
} {
  return {
    currentTotal: current.length,
    previousTotal: previous.length,
    currentSuccessRate: current.length > 0 ? (current.filter(isSuccess).length / current.length) * 100 : null,
    previousSuccessRate: previous.length > 0 ? (previous.filter(isSuccess).length / previous.length) * 100 : null,
    currentAvgConfidence: averageConfidence(current),
    previousAvgConfidence: averageConfidence(previous),
    currentAvgResponseTime: averageResponseTimeMinutes(current),
    previousAvgResponseTime: averageResponseTimeMinutes(previous),
  }
}

function bucketLabel(date: Date, period: StatsPeriod): string {
  if (period === '24h') {
    return date.toLocaleTimeString('en-US', { hour: 'numeric' }).replace(/^0/, '')
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function createTrendData(current: DecisionRecord[], previous: DecisionRecord[], range: RangeWindow, compareEnabled: boolean): TrendRow[] {
  const bucketCount = range.bucketCount
  const step = (range.end - range.start) / bucketCount
  const makeBuckets = (): Array<{ label: string; start: number; end: number }> =>
    Array.from({ length: bucketCount }).map((_, index) => {
      const start = range.start + step * index
      const end = index === bucketCount - 1 ? range.end : start + step
      return {
        label: bucketLabel(new Date(start), range.bucketCount === 24 ? '24h' : '7d'),
        start,
        end,
      }
    })

  const buckets = makeBuckets()
  const createSeries = (items: DecisionRecord[]): Array<{ sum: number; count: number }> => Array.from({ length: bucketCount }).map(() => ({ sum: 0, count: 0 }))
  const currentSeries = createSeries(current)
  const previousSeries = createSeries(previous)

  const assignToSeries = (decision: DecisionRecord, series: Array<{ sum: number; count: number }>, start: number, end: number) => {
    const timestamp = getTimestamp(decision)
    if (timestamp < start || timestamp > end) {
      return
    }

    const ratio = (timestamp - start) / Math.max(1, end - start)
    const bucketIndex = Math.min(series.length - 1, Math.max(0, Math.floor(ratio * series.length)))
    const value = typeof decision.confidence === 'number' ? decision.confidence * 100 : null

    if (value !== null) {
      series[bucketIndex].sum += value
      series[bucketIndex].count += 1
    }
  }

  current.forEach((decision) => assignToSeries(decision, currentSeries, range.start, range.end))

  if (compareEnabled) {
    const previousStart = range.start - (range.end - range.start)
    const previousEnd = range.start - 1
    previous.forEach((decision) => assignToSeries(decision, previousSeries, previousStart, previousEnd))
  }

  return buckets.map((bucket, index) => ({
    label: bucket.label,
    currentConfidence: currentSeries[index].count > 0 ? currentSeries[index].sum / currentSeries[index].count : null,
    previousConfidence: compareEnabled && previousSeries[index].count > 0 ? previousSeries[index].sum / previousSeries[index].count : null,
  }))
}

function currentPreviousActionRates(current: DecisionRecord[], previous: DecisionRecord[], compareEnabled: boolean): ActionSuccessRow[] {
  const currentMap = new Map<string, { total: number; success: number }>()
  const previousMap = new Map<string, { total: number; success: number }>()

  for (const decision of current) {
    const key = getDecisionActionType(decision)
    const entry = currentMap.get(key) ?? { total: 0, success: 0 }
    entry.total += 1
    entry.success += isConverted(decision) ? 1 : 0
    currentMap.set(key, entry)
  }

  if (compareEnabled) {
    for (const decision of previous) {
      const key = getDecisionActionType(decision)
      const entry = previousMap.get(key) ?? { total: 0, success: 0 }
      entry.total += 1
      entry.success += isConverted(decision) ? 1 : 0
      previousMap.set(key, entry)
    }
  }

  const actionTypes = Array.from(new Set([...currentMap.keys(), ...previousMap.keys()]))
    .map((actionType) => ({
      actionType,
      currentCount: currentMap.get(actionType)?.total ?? 0,
      previousCount: previousMap.get(actionType)?.total ?? 0,
      totalCount: (currentMap.get(actionType)?.total ?? 0) + (previousMap.get(actionType)?.total ?? 0),
    }))
    .sort((left, right) => right.totalCount - left.totalCount)
    .slice(0, 8)
    .map(({ actionType }) => {
      const currentEntry = currentMap.get(actionType)
      const previousEntry = previousMap.get(actionType)

      return {
        actionType,
        currentRate: currentEntry && currentEntry.total > 0 ? (currentEntry.success / currentEntry.total) * 100 : 0,
        previousRate: compareEnabled && previousEntry && previousEntry.total > 0 ? (previousEntry.success / previousEntry.total) * 100 : 0,
        currentCount: currentEntry?.total ?? 0,
        previousCount: previousEntry?.total ?? 0,
      }
    })

  return actionTypes
}

function topActions(current: DecisionRecord[]): PieSlice[] {
  const counts = new Map<string, number>()

  for (const decision of current) {
    const key = formatActionType(String(getDecisionActionType(decision)))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const top = Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 5)

  const total = top.reduce((sum, entry) => sum + entry.value, 0)

  return top.map((entry) => ({
    ...entry,
    percentage: total > 0 ? (entry.value / total) * 100 : 0,
  }))
}

function urgencyStacks(current: DecisionRecord[], previous: DecisionRecord[]): UrgencyStackRow[] {
  const buildCounts = (items: DecisionRecord[]) => ({
    critical: items.filter((decision) => getDecisionUrgency(decision) === 'critical').length,
    high: items.filter((decision) => getDecisionUrgency(decision) === 'high').length,
    medium: items.filter((decision) => getDecisionUrgency(decision) === 'medium').length,
    low: items.filter((decision) => getDecisionUrgency(decision) === 'low').length,
  })

  return [
    { period: 'Current', ...buildCounts(current) },
    { period: 'Previous', ...buildCounts(previous) },
  ]
}

function averageConfidenceDelta(current: number | null, previous: number | null): string | undefined {
  if (current === null || previous === null) {
    return undefined
  }

  const delta = current - previous
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts`
}

function responseTimeDelta(current: number | null, previous: number | null): string | undefined {
  if (current === null || previous === null) {
    return undefined
  }

  const delta = current - previous
  return `${delta >= 0 ? '+' : ''}${formatMinutes(Math.abs(delta))}`
}

function successRateDelta(current: number | null, previous: number | null): string | undefined {
  if (current === null || previous === null) {
    return undefined
  }

  const delta = current - previous
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts`
}

function miniMetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200/80 bg-white/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{value}</div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{helper}</p>
    </div>
  )
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
      <p className="font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <p className="mt-2 leading-6">{message}</p>
    </div>
  )
}

export function DecisionStats({ decisions, isLoading = false, className = '' }: DecisionStatsProps) {
  const gradientId = useId().replace(/:/g, '')
  const [period, setPeriod] = useState<StatsPeriod>('7d')
  const [compareEnabled, setCompareEnabled] = useState(true)
  const [customStart, setCustomStart] = useState(() => toDateInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))
  const [customEnd, setCustomEnd] = useState(() => toDateInputValue(new Date()))

  const currentRange = useMemo(() => getPeriodWindow(period, customStart, customEnd), [customEnd, customStart, period])
  const previousRange = useMemo(() => (currentRange ? getPreviousWindow(currentRange) : null), [currentRange])

  const currentAndPrevious = useMemo(() => {
    if (!currentRange || !previousRange) {
      return { current: [], previous: [] }
    }

    return getCurrentAndPrevious(decisions, currentRange, previousRange)
  }, [currentRange, decisions, previousRange])

  const summary = useMemo(() => {
    if (!currentRange || !previousRange) {
      return {
        currentTotal: 0,
        previousTotal: 0,
        currentSuccessRate: null,
        previousSuccessRate: null,
        currentAvgConfidence: null,
        previousAvgConfidence: null,
        currentAvgResponseTime: null,
        previousAvgResponseTime: null,
      }
    }

    return computeSummary(currentAndPrevious.current, currentAndPrevious.previous)
  }, [currentAndPrevious, currentRange, previousRange])
  const actionSuccessData = useMemo(() => currentPreviousActionRates(currentAndPrevious.current, currentAndPrevious.previous, compareEnabled), [compareEnabled, currentAndPrevious])
  const trendData = useMemo(() => {
    if (!currentRange || !previousRange) {
      return []
    }

    return createTrendData(currentAndPrevious.current, currentAndPrevious.previous, currentRange, compareEnabled)
  }, [compareEnabled, currentAndPrevious, currentRange, previousRange])
  const actionPieData = useMemo(() => topActions(currentAndPrevious.current), [currentAndPrevious.current])
  const urgencyData = useMemo(() => urgencyStacks(currentAndPrevious.current, currentAndPrevious.previous), [currentAndPrevious])

  const currentAverageConfidence = averageConfidence(currentAndPrevious.current)
  const previousAverageConfidence = averageConfidence(currentAndPrevious.previous)
  const currentResponseTime = averageResponseTimeMinutes(currentAndPrevious.current)
  const previousResponseTime = averageResponseTimeMinutes(currentAndPrevious.previous)

  const now = Date.now()
  const currentTotals = [
    { label: '24h', value: countInRange(decisions, now - 24 * 60 * 60 * 1000, now) },
    { label: '7d', value: countInRange(decisions, now - 7 * 24 * 60 * 60 * 1000, now) },
    { label: '30d', value: countInRange(decisions, now - 30 * 24 * 60 * 60 * 1000, now) },
  ]

  const customRangeInvalid = period === 'custom' && (!currentRange || !previousRange)
  const emptyCurrent = currentAndPrevious.current.length === 0
  const noComparison = !compareEnabled

  return (
    <div className={cn('space-y-6', className)}>
      <SectionCard
        title="Decision Stats"
        description="Analytics for the filtered decision set with period comparison and response-time tracking."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info" className="gap-2">
              <Gauge className="h-3.5 w-3.5" />
              Comparison {compareEnabled ? 'on' : 'off'}
            </Badge>
            <button
              type="button"
              onClick={() => setCompareEnabled((current) => !current)}
              className={cn('inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition', compareEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-slate-200 bg-white/85 text-slate-700 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300')}
            >
              Compare previous period
            </button>
          </div>
        )}
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriod(option.value)}
                className={cn(
                  'rounded-full px-3.5 py-2 text-sm font-medium transition',
                  period === option.value
                    ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
                    : 'border border-slate-200 bg-white/85 text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {period === 'custom' ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Start date</span>
                <input
                  type="date"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                  aria-label="Custom start date"
                  className="h-11 w-full rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">End date</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                  aria-label="Custom end date"
                  className="h-11 w-full rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300"
                />
              </label>
              <div className="flex items-end">
                <Badge tone={customRangeInvalid ? 'danger' : 'neutral'} className="h-11 w-full justify-center">
                  {customRangeInvalid ? 'Choose a valid start and end date' : 'Custom range ready'}
                </Badge>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            {currentTotals.map((entry) => miniMetricCard({ label: entry.label, value: formatMetricValue(entry.value), helper: `Decisions in the last ${entry.label}` }))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {isLoading
              ? Array.from({ length: 4 }).map((_, index) => <MetricCardSkeleton key={index} />)
              : [
                  {
                    label: 'Total decisions',
                    value: summary.currentTotal,
                    helper: `Current ${currentRange?.label ?? 'period'}`,
                    delta: compareEnabled ? (summary.currentTotal - summary.previousTotal >= 0 ? `+${summary.currentTotal - summary.previousTotal}` : `${summary.currentTotal - summary.previousTotal}`) : undefined,
                    icon: BarChart3,
                    tone: 'indigo' as const,
                  },
                  {
                    label: 'Success rate',
                    value: summary.currentSuccessRate ?? 0,
                    format: 'ratio' as const,
                    helper: 'Converted or completed decisions',
                    delta: compareEnabled ? successRateDelta(summary.currentSuccessRate, summary.previousSuccessRate) : undefined,
                    icon: Percent,
                    tone: 'emerald' as const,
                  },
                  {
                    label: 'Average confidence',
                    value: summary.currentAvgConfidence ?? 0,
                    format: 'ratio' as const,
                    helper: 'Mean confidence score',
                    delta: compareEnabled ? averageConfidenceDelta(summary.currentAvgConfidence, summary.previousAvgConfidence) : undefined,
                    icon: TrendingUp,
                    tone: 'cyan' as const,
                  },
                  {
                    label: 'Avg response time',
                    value: summary.currentAvgResponseTime ?? 0,
                    format: 'decimal' as const,
                    helper: 'Decision to acknowledgment',
                    delta: compareEnabled ? responseTimeDelta(summary.currentAvgResponseTime, summary.previousAvgResponseTime) : undefined,
                    icon: Timer,
                    tone: 'rose' as const,
                  },
                ].map((metric) => <MetricCard key={metric.label} {...metric} loading={false} />)}
          </div>
        </div>
      </SectionCard>

      {isLoading ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : customRangeInvalid ? (
        <EmptyState title="Invalid custom range" message="Pick a start date that is on or before the end date to view analytics for a custom window." />
      ) : emptyCurrent ? (
        <EmptyState title="No decisions in range" message="There are no decisions in the selected period. Try a wider date range or clear some dashboard filters." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <SectionCard title="Success rate by action type" description="Current period success rate against the comparison window.">
            {actionSuccessData.length === 0 ? (
              <EmptyState title="No action types to chart" message="This period does not include enough decisions to build an action-type success breakdown." />
            ) : (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={actionSuccessData} margin={{ top: 12, right: 12, left: 0, bottom: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
                    <XAxis dataKey="actionType" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} interval={0} angle={-15} textAnchor="end" height={56} />
                    <YAxis tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: '#cbd5e1' }}
                      formatter={(value: number, name: string, entry) => [
                        `${Number(value).toFixed(1)}%`,
                        name === 'currentRate' ? 'Current' : 'Previous',
                      ]}
                      labelFormatter={(label) => `Action: ${label}`}
                    />
                    <Legend wrapperStyle={legendStyle} />
                    <Bar dataKey="currentRate" name="Current" fill="#4f46e5" radius={[10, 10, 0, 0]} />
                    {compareEnabled ? <Bar dataKey="previousRate" name="Previous" fill="#94a3b8" radius={[10, 10, 0, 0]} /> : null}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Average confidence over time" description="Trend by bucket for the current and previous period.">
            {trendData.length === 0 ? (
              <EmptyState title="No trend data" message="There are not enough decisions to plot confidence over time in this period." />
            ) : (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 12, right: 12, left: 0, bottom: 12 }}>
                    <defs>
                      <linearGradient id={`confidenceGradient-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: '#cbd5e1' }}
                      formatter={(value: number | null, name: string) => [
                        value === null ? 'No data' : `${Number(value).toFixed(1)}%`,
                        name === 'currentConfidence' ? 'Current' : 'Previous',
                      ]}
                    />
                    <Legend wrapperStyle={legendStyle} />
                    <Line type="monotone" dataKey="currentConfidence" name="Current" stroke="#4f46e5" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} fill={`url(#confidenceGradient-${gradientId})`} />
                    {compareEnabled ? <Line type="monotone" dataKey="previousConfidence" name="Previous" stroke="#94a3b8" strokeWidth={2.5} dot={{ r: 2 }} strokeDasharray="6 4" /> : null}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Top 5 most frequent actions" description="Current-period action distribution by share.">
            {actionPieData.length === 0 ? (
              <EmptyState title="No actions to summarize" message="This period has no actions available for a frequency breakdown." />
            ) : (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="mx-auto h-72 w-full max-w-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={actionPieData} dataKey="value" nameKey="name" innerRadius={72} outerRadius={110} paddingAngle={3}>
                        {actionPieData.map((entry, index) => (
                          <Cell key={entry.name} fill={ACTION_PALETTE[index % ACTION_PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value: number, name: string, entry) => [`${Number(value)} decisions`, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-3">
                  {actionPieData.map((entry, index) => (
                    <div key={entry.name} className="rounded-2xl border border-slate-200/80 px-4 py-3 dark:border-slate-800">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ACTION_PALETTE[index % ACTION_PALETTE.length] }} />
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{entry.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-slate-950 dark:text-white">{entry.value}</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-900">
                        <div className="h-full rounded-full" style={{ width: `${entry.percentage}%`, backgroundColor: ACTION_PALETTE[index % ACTION_PALETTE.length] }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Decisions by urgency" description="Stacked period comparison by urgency class.">
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={urgencyData} margin={{ top: 12, right: 12, left: 0, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
                  <XAxis dataKey="period" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#cbd5e1' }} />
                  <Legend wrapperStyle={legendStyle} />
                  <Bar dataKey="critical" stackId="urgency" name="Critical" fill={URGENCY_COLORS.critical} radius={[10, 10, 0, 0]} />
                  <Bar dataKey="high" stackId="urgency" name="High" fill={URGENCY_COLORS.high} />
                  <Bar dataKey="medium" stackId="urgency" name="Medium" fill={URGENCY_COLORS.medium} />
                  <Bar dataKey="low" stackId="urgency" name="Low" fill={URGENCY_COLORS.low} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard title="Response time metrics" description="Average decision-to-acknowledgment timing for the selected period.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-[22px] border border-slate-200/80 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Current period</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">{formatMinutes(currentResponseTime)}</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Average decision to acknowledgment time</p>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Previous period</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">{formatMinutes(previousResponseTime)}</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Comparison baseline for the same window length</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="info">Acknowledgment timestamp fallback: acknowledged_at or updated_at</Badge>
              {noComparison ? <Badge tone="muted">Comparison disabled</Badge> : null}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  )
}

export default DecisionStats
