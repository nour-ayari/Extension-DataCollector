import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { RefreshCcw, Sparkles } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Badge } from '../components/Badge.jsx'
import { MetricCard } from '../components/MetricCard.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { SectionCard } from '../components/SectionCard.jsx'
import { MetricCardSkeleton } from '../components/Skeletons.jsx'
import { ActivityStream } from '../components/dashboard/ActivityStream'
import { CriticalActionQueue } from '../components/dashboard/CriticalActionQueue'
import { DecisionStats } from '../components/dashboard/DecisionStats'
import {
  DashboardFilters,
  DEFAULT_DASHBOARD_FILTERS,
  dashboardFiltersToDecisionFilters,
  countActiveDashboardFilters,
  parseDashboardFilters,
  serializeDashboardFilters,
  type DashboardFilterValues,
} from '../components/dashboard/DashboardFilters'
import { DecisionDetailPanel } from '../components/dashboard/DecisionDetailPanel'
import { PersonaSentimentHeatmap, type HeatmapSelection } from '../components/dashboard/Heatmap'
import { useAllDecisions } from '../hooks/useDecisions'
import { cn } from '../utils/cn.js'
import { getDecisionUrgency, isConverted } from '../utils/decision'
import type { DecisionRecord } from '../types/api'

function DashboardErrorFallback({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
      <p className="font-semibold">{label} failed to load.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500"
      >
        Retry
      </button>
    </div>
  )
}

class SectionErrorBoundary extends Component<
  {
    label: string
    onRetry: () => void
    children: ReactNode
  },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // No-op: the fallback UI is enough for this dashboard surface.
  }

  render() {
    if (this.state.hasError) {
      return <DashboardErrorFallback label={this.props.label} onRetry={this.props.onRetry} />
    }

    return this.props.children
  }
}

function SectionSkeleton({ title, lines = 4 }: { title: string; lines?: number }) {
  return (
    <SectionCard title={title} description="Loading live data...">
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-[20px] bg-slate-200/70 dark:bg-slate-800/70" />
        ))}
      </div>
    </SectionCard>
  )
}

export default function Dashboard() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [appliedFilters, setAppliedFilters] = useState<DashboardFilterValues>(() => parseDashboardFilters(searchParams))
  const [heatmapSelection, setHeatmapSelection] = useState<HeatmapSelection | null>(null)
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null)
  const [boundaryResetToken, setBoundaryResetToken] = useState(0)

  useEffect(() => {
    setAppliedFilters(parseDashboardFilters(searchParams))
  }, [searchParams])

  useEffect(() => {
    const handleViewDecision = (event: Event) => {
      const customEvent = event as CustomEvent<{ decisionId?: string }>
      const decisionId = customEvent.detail?.decisionId

      if (decisionId) {
        setSelectedDecisionId(decisionId)
      }
    }

    window.addEventListener('dashboard:view-decision', handleViewDecision)
    return () => window.removeEventListener('dashboard:view-decision', handleViewDecision)
  }, [])

  const decisionFilters = useMemo(() => dashboardFiltersToDecisionFilters(appliedFilters), [appliedFilters])
  const { data: decisions = [], isLoading, error, refetch } = useAllDecisions(decisionFilters)

  const totalDecisions = decisions.length
  const criticalCount = decisions.filter((decision) => getDecisionUrgency(decision) === 'critical').length
  const successRate = totalDecisions > 0 ? decisions.filter(isConverted).length / totalDecisions : 0
  const activeFilterCount = countActiveDashboardFilters(appliedFilters)
  const liveFetchCount = useIsFetching({ queryKey: ['decisions'] }) + useIsFetching({ queryKey: ['decision'] })

  const refreshAll = async () => {
    setBoundaryResetToken((current) => current + 1)

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['decisions'] }),
      queryClient.invalidateQueries({ queryKey: ['decision'] }),
      queryClient.invalidateQueries({ queryKey: ['decision-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['recommendation'] }),
      refetch(),
    ])
  }

  const handleApplyFilters = (nextFilters: DashboardFilterValues) => {
    setAppliedFilters(nextFilters)
    setSearchParams(serializeDashboardFilters(nextFilters), { replace: false })
  }

  const handleClearFilters = () => {
    setAppliedFilters(DEFAULT_DASHBOARD_FILTERS)
    setHeatmapSelection(null)
    setSelectedDecisionId(null)
    setSearchParams(new URLSearchParams(), { replace: false })
  }

  const stats = [
    {
      label: 'Filtered decisions',
      value: totalDecisions,
      helper: `Active filters: ${activeFilterCount}`,
      tone: 'indigo' as const,
    },
    {
      label: 'Critical count',
      value: criticalCount,
      helper: 'Requires immediate attention',
      tone: 'rose' as const,
    },
    {
      label: 'Success rate',
      value: successRate,
      format: 'ratio' as const,
      helper: 'Converted or completed decisions in scope',
      tone: 'emerald' as const,
    },
  ]

  return (
    <>
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        eyebrow="Dashboard"
        title="AI decision cockpit"
        description="Track the live decision pipeline, review critical actions, inspect heatmap distribution, and open the full decision trace."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm', liveFetchCount > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-slate-200 bg-white/80 text-slate-600 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300')}>
              <span className={cn('h-2.5 w-2.5 rounded-full', liveFetchCount > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-700')} />
              {liveFetchCount > 0 ? 'Live updates active' : 'Idle'}
            </div>
            <button
              type="button"
              onClick={() => void refreshAll()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-700"
            >
              <RefreshCcw className={cn('h-4 w-4', liveFetchCount > 0 && 'animate-spin')} />
              Refresh
            </button>
          </div>
        )}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading
          ? Array.from({ length: 3 }).map((_, index) => <MetricCardSkeleton key={index} />)
          : stats.map((metric) => (
              <MetricCard key={metric.label} label={metric.label} value={metric.value} format={metric.format} helper={metric.helper} tone={metric.tone} icon={Sparkles} loading={false} />
            ))}
      </div>

      <DashboardFilters value={appliedFilters} onApply={handleApplyFilters} onClearAll={handleClearFilters} />

      <DecisionStats decisions={decisions} isLoading={isLoading} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.55fr)]">
        <div className="min-w-0">
          <SectionErrorBoundary key={`critical-${boundaryResetToken}`} label="Critical queue" onRetry={() => void refreshAll()}>
            {isLoading ? <SectionSkeleton title="Critical Action Queue" lines={3} /> : <CriticalActionQueue filters={decisionFilters} onDecisionSelect={setSelectedDecisionId} />}
          </SectionErrorBoundary>
        </div>

        <div className="min-w-0">
          <SectionErrorBoundary key={`stream-${boundaryResetToken}`} label="Activity stream" onRetry={() => void refreshAll()}>
            {isLoading ? (
              <SectionSkeleton title="Activity Stream" lines={5} />
            ) : (
              <ActivityStream selection={heatmapSelection} filters={decisionFilters} onDecisionSelect={setSelectedDecisionId} />
            )}
          </SectionErrorBoundary>
        </div>
      </div>

      <SectionErrorBoundary key={`heatmap-${boundaryResetToken}`} label="Persona heatmap" onRetry={() => void refreshAll()}>
        {isLoading ? <SectionSkeleton title="Persona-Sentiment Heatmap" lines={5} /> : <PersonaSentimentHeatmap activeSelection={heatmapSelection} filters={decisionFilters} onCellSelect={setHeatmapSelection} />}
      </SectionErrorBoundary>

    </div>

    {!isLoading && selectedDecisionId ? <DecisionDetailPanel decisionId={selectedDecisionId} onClose={() => setSelectedDecisionId(null)} /> : null}

    {error ? (
      <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
        The dashboard data could not be loaded. Try refreshing the page state.
      </div>
    ) : null}
  </>
  )
}
