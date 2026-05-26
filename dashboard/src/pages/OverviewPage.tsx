import { useMemo, useState } from 'react'
import { ArrowRight, BarChart3, CheckCircle2, Gauge, RefreshCcw, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/Badge.jsx'
import { DataTable } from '../components/DataTable.jsx'
import { DecisionStats } from '../components/dashboard/DecisionStats'
import { MetricCard } from '../components/MetricCard.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { SectionCard } from '../components/SectionCard.jsx'
import { MetricCardSkeleton } from '../components/Skeletons.jsx'
import { useAllDecisions } from '../hooks/useDecisions'
import { formatConfidence, formatDateTime } from '../utils/format.js'
import { getDecisionTimestamp, getDecisionUrgency, isConverted } from '../utils/decision'
import type { DecisionRecord } from '../types/api'

const filterOptions = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'converted', label: 'Converted' },
] as const

function urgencyTone(urgency: string): string {
  if (urgency === 'critical') {
    return 'danger'
  }

  if (urgency === 'high') {
    return 'warning'
  }

  if (urgency === 'medium') {
    return 'info'
  }

  return 'muted'
}

function outcomeTone(decision: DecisionRecord): string {
  return isConverted(decision) ? 'success' : 'muted'
}

export default function OverviewPage() {
  const { data: decisions = [], isLoading, error, refetch } = useAllDecisions()
  const [activeFilter, setActiveFilter] = useState<(typeof filterOptions)[number]['key']>('all')

  const sortedDecisions = useMemo(
    () => [...decisions].sort((left, right) => new Date(getDecisionTimestamp(right)).getTime() - new Date(getDecisionTimestamp(left)).getTime()),
    [decisions],
  )

  const summary = useMemo(() => {
    const total = decisions.length
    const critical = decisions.filter((decision) => getDecisionUrgency(decision) === 'critical').length
    const converted = decisions.filter(isConverted).length
    const confidenceTotal = decisions.reduce((sum, decision) => sum + (decision.confidence ?? 0), 0)

    return {
      total,
      critical,
      converted,
      conversionRate: total > 0 ? converted / total : 0,
      averageConfidence: total > 0 ? confidenceTotal / total : 0,
    }
  }, [decisions])

  const visibleDecisions = useMemo(() => {
    if (activeFilter === 'critical') {
      return sortedDecisions.filter((decision) => getDecisionUrgency(decision) === 'critical')
    }

    if (activeFilter === 'converted') {
      return sortedDecisions.filter(isConverted)
    }

    return sortedDecisions
  }, [activeFilter, sortedDecisions])

  const columns = useMemo(
    () => [
      {
        key: 'user_id',
        label: 'User',
        render: (row: DecisionRecord) => (
          <div>
            <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{row.user_id}</div>
            <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{row.id ?? row.decision_id ?? 'Decision'}</div>
          </div>
        ),
      },
      {
        key: 'persona',
        label: 'Persona',
        render: (row: DecisionRecord) => <Badge tone="info">{row.persona}</Badge>,
      },
      {
        key: 'sentiment',
        label: 'Sentiment',
        render: (row: DecisionRecord) => <Badge tone={row.sentiment === 'Positive' ? 'success' : row.sentiment === 'Negative' ? 'danger' : 'neutral'}>{row.sentiment}</Badge>,
      },
      {
        key: 'urgency',
        label: 'Urgency',
        render: (row: DecisionRecord) => <Badge tone={urgencyTone(getDecisionUrgency(row))}>{getDecisionUrgency(row)}</Badge>,
      },
      {
        key: 'confidence',
        label: 'Confidence',
        render: (row: DecisionRecord) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{formatConfidence(row.confidence ?? 0)}</span>,
      },
      {
        key: 'outcome',
        label: 'Outcome',
        render: (row: DecisionRecord) => <Badge tone={outcomeTone(row)}>{isConverted(row) ? 'Converted' : 'Open'}</Badge>,
      },
      {
        key: 'created_at',
        label: 'Time',
        render: (row: DecisionRecord) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{formatDateTime(getDecisionTimestamp(row))}</span>,
      },
    ],
    [],
  )

  const metrics = [
    {
      label: 'Total decisions',
      value: summary.total,
      helper: 'Live records returned by the API',
      tone: 'indigo' as const,
      icon: BarChart3,
    },
    {
      label: 'Critical decisions',
      value: summary.critical,
      helper: 'Need immediate operator review',
      tone: 'rose' as const,
      icon: TriangleAlert,
    },
    {
      label: 'Converted decisions',
      value: summary.converted,
      helper: 'Already resolved in the workflow',
      tone: 'emerald' as const,
      icon: CheckCircle2,
    },
    {
      label: 'Average confidence',
      value: summary.averageConfidence,
      format: 'ratio' as const,
      helper: 'Mean confidence across the live feed',
      tone: 'cyan' as const,
      icon: Gauge,
    },
  ]

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        eyebrow="Overview"
        title="Recommendation intelligence"
        description="Monitor live decision volume, conversion quality, and urgent actions without falling back to mock data."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-700"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-indigo-500 hover:shadow-lg"
            >
              Open cockpit
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, index) => <MetricCardSkeleton key={index} />)
          : metrics.map((metric) => (
              <MetricCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                format={metric.format}
                helper={metric.helper}
                tone={metric.tone}
                icon={metric.icon}
                loading={false}
              />
            ))}
      </div>

      <DecisionStats decisions={decisions} isLoading={isLoading} />

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <SectionCard title="Recent decisions" description="Latest API-backed decisions with no mocked state or local shadow copies.">
          <DataTable columns={columns} data={visibleDecisions.slice(0, 8)} loading={isLoading} skeletonRows={6} />
        </SectionCard>

        <SectionCard
          title="Review filters"
          description="Quickly scope the live set to critical or converted decisions."
          actions={(
            <div className="flex flex-wrap gap-2">
              {filterOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setActiveFilter(option.key)}
                  className={
                    activeFilter === option.key
                      ? 'rounded-full bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white'
                      : 'rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300'
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        >
          <div className="space-y-3 text-sm text-slate-500 dark:text-slate-400">
            <p>Filtered records: <span className="font-semibold text-slate-900 dark:text-white">{visibleDecisions.length}</span></p>
            <p>Conversion rate: <span className="font-semibold text-slate-900 dark:text-white">{formatConfidence(summary.conversionRate)}</span></p>
            <p>Average confidence: <span className="font-semibold text-slate-900 dark:text-white">{formatConfidence(summary.averageConfidence)}</span></p>
            {error ? <p className="text-rose-600 dark:text-rose-300">Failed to load live decisions.</p> : null}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
