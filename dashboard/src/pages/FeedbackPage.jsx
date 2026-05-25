import { useState } from 'react'
import { CheckCircle2, RefreshCcw, XCircle } from 'lucide-react'
import { Badge } from '../components/Badge.jsx'
import { DataTable } from '../components/DataTable.jsx'
import { MetricCard } from '../components/MetricCard.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { SectionCard } from '../components/SectionCard.jsx'
import { useDashboardSnapshot } from '../hooks/useDashboardSnapshot.js'
import { formatConfidence, formatDateTime } from '../utils/format.js'

function statusTone(status) {
  if (status === 'converted') {
    return 'success'
  }

  if (status === 'dismissed') {
    return 'muted'
  }

  return 'warning'
}

export default function FeedbackPage() {
  const { feedbackQueue, loading, refresh, refreshedAt } = useDashboardSnapshot()
  const [queue, setQueue] = useState(feedbackQueue)

  const pendingItems = queue.filter((item) => item.status === 'pending')
  const convertedItems = queue.filter((item) => item.status === 'converted')
  const averageConfidence =
    queue.length > 0 ? queue.reduce((sum, item) => sum + item.confidence, 0) / queue.length : 0

  const markOutcome = (id, status) => {
    setQueue((currentQueue) =>
      currentQueue.map((item) => (item.id === id ? { ...item, status } : item)),
    )
  }

  const columns = [
    {
      key: 'id',
      label: 'Log ID',
      render: (row) => (
        <div>
          <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{row.id}</div>
          <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{row.userId}</div>
        </div>
      ),
    },
    {
      key: 'persona',
      label: 'Persona',
      render: (row) => <Badge tone="info">{row.persona}</Badge>,
    },
    {
      key: 'action',
      label: 'Action',
      render: (row) => <span className="font-medium text-slate-700 dark:text-slate-200">{row.action}</span>,
    },
    {
      key: 'confidence',
      label: 'Confidence',
      render: (row) => <Badge tone="muted">{formatConfidence(row.confidence)}</Badge>,
    },
    {
      key: 'receivedAt',
      label: 'Time',
      render: (row) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{formatDateTime(row.receivedAt)}</span>,
    },
    {
      key: 'status',
      label: 'Outcome',
      render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>,
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => markOutcome(row.id, 'converted')}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:-translate-y-0.5 dark:text-emerald-300"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Convert
          </button>
          <button
            type="button"
            onClick={() => markOutcome(row.id, 'dismissed')}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:-translate-y-0.5 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300"
          >
            <XCircle className="h-3.5 w-3.5" />
            Dismiss
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        eyebrow="Feedback"
        title="Close the loop"
        description="Approve, dismiss, or convert recommendations to keep the feedback pipeline clean and actionable."
        actions={
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-700"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh queue
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Pending items"
          value={pendingItems.length}
          helper="Awaiting review and outcome update"
          tone="indigo"
          loading={loading}
          icon={CheckCircle2}
        />
        <MetricCard
          label="Converted"
          value={convertedItems.length}
          helper="Already marked as a successful outcome"
          tone="emerald"
          loading={loading}
          icon={CheckCircle2}
        />
        <MetricCard
          label="Average confidence"
          value={averageConfidence}
          format="ratio"
          helper="Mean confidence across the active queue"
          tone="cyan"
          loading={loading}
          icon={CheckCircle2}
        />
        <MetricCard
          label="Last refresh"
          value={refreshedAt ? 1 : 0}
          format="compact"
          helper={loading ? 'Loading snapshot' : `Updated ${formatDateTime(refreshedAt)}`}
          tone="rose"
          loading={loading}
          icon={RefreshCcw}
        />
      </div>

      <SectionCard
        title="Pending outcome review"
        description="Review the latest feedback items and update the recommendation outcome in one click."
      >
        <DataTable columns={columns} data={queue} loading={loading} skeletonRows={5} />
      </SectionCard>
    </div>
  )
}