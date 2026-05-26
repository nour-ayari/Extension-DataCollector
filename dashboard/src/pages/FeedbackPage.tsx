import { useMemo, useState } from 'react'
import { CheckCircle2, RefreshCcw, TriangleAlert } from 'lucide-react'
import { Badge } from '../components/Badge.jsx'
import { DataTable } from '../components/DataTable.jsx'
import { MetricCard } from '../components/MetricCard.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { SectionCard } from '../components/SectionCard.jsx'
import { useAllDecisions } from '../hooks/useDecisions'
import { formatConfidence, formatDateTime } from '../utils/format.js'
import { getDecisionTimestamp, getDecisionUrgency, isConverted } from '../utils/decision'
import type { DecisionRecord } from '../types/api'

const filterOptions = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'converted', label: 'Converted' },
  { key: 'open', label: 'Open' },
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

export default function FeedbackPage() {
  const { data: decisions = [], isLoading, error, refetch } = useAllDecisions()
  const [activeFilter, setActiveFilter] = useState<(typeof filterOptions)[number]['key']>('all')

  const sortedDecisions = useMemo(
    () => [...decisions].sort((left, right) => new Date(getDecisionTimestamp(right)).getTime() - new Date(getDecisionTimestamp(left)).getTime()),
    [decisions],
  )

  const visibleDecisions = useMemo(() => {
    if (activeFilter === 'critical') {
      return sortedDecisions.filter((decision) => getDecisionUrgency(decision) === 'critical')
    }

    if (activeFilter === 'converted') {
      return sortedDecisions.filter(isConverted)
    }

    if (activeFilter === 'open') {
      return sortedDecisions.filter((decision) => !isConverted(decision))
    }

    return sortedDecisions
  }, [activeFilter, sortedDecisions])

  const summary = useMemo(() => {
    const total = decisions.length
    const converted = decisions.filter(isConverted).length
    const critical = decisions.filter((decision) => getDecisionUrgency(decision) === 'critical').length
    const confidenceTotal = decisions.reduce((sum, decision) => sum + (decision.confidence ?? 0), 0)

    return {
      total,
      converted,
      critical,
      averageConfidence: total > 0 ? confidenceTotal / total : 0,
    }
  }, [decisions])

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
        render: (row: DecisionRecord) => <Badge tone={isConverted(row) ? 'success' : 'muted'}>{isConverted(row) ? 'Converted' : 'Open'}</Badge>,
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
      label: 'Pending review',
      value: summary.total - summary.converted,
      helper: 'Live items still open in the queue',
      tone: 'indigo' as const,
      icon: CheckCircle2,
    },
    {
      label: 'Converted',
      value: summary.converted,
      helper: 'Feedback loop entries already closed',
      tone: 'emerald' as const,
      icon: CheckCircle2,
    },
    {
      label: 'Critical',
      value: summary.critical,
      helper: 'Requires immediate attention',
      tone: 'rose' as const,
      icon: TriangleAlert,
    },
    {
      label: 'Average confidence',
      value: summary.averageConfidence,
      format: 'ratio' as const,
      helper: 'Mean score across the live queue',
      tone: 'cyan' as const,
      icon: RefreshCcw,
    },
  ]

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        eyebrow="Feedback"
        title="Close the loop"
        description="Review the live decision queue without any local shadow state or mock feedback snapshots."
        actions={(
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-700"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh queue
          </button>
        )}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, index) => <MetricCard key={index} loading={true} />)
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

      <SectionCard
        title="Live review queue"
        description="Filter by urgency or outcome and inspect the API-backed decision records directly."
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
        <DataTable columns={columns} data={visibleDecisions} loading={isLoading} skeletonRows={6} />
      </SectionCard>

      {error ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
          The live queue could not be loaded. Try refreshing the API connection.
        </div>
      ) : null}
    </div>
  )
}
