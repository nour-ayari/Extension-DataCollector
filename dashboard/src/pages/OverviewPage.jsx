import { useState } from 'react'
import {
  Area,
  AreaChart,
  Cell,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowRight, RefreshCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/Badge.jsx'
import { DataTable } from '../components/DataTable.jsx'
import { MetricCard } from '../components/MetricCard.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { SectionCard } from '../components/SectionCard.jsx'
import { ChartSkeleton, MetricCardSkeleton } from '../components/Skeletons.jsx'
import { useDashboardSnapshot } from '../hooks/useDashboardSnapshot.js'
import { formatDateTime } from '../utils/format.js'

const filterOptions = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'converted', label: 'Converted' },
]

function sentimentTone(sentiment) {
  if (sentiment === 'Positive') {
    return 'success'
  }

  if (sentiment === 'Negative') {
    return 'danger'
  }

  return 'neutral'
}

function urgencyTone(urgency) {
  if (urgency === 'Critical') {
    return 'danger'
  }

  if (urgency === 'High') {
    return 'warning'
  }

  if (urgency === 'Medium') {
    return 'info'
  }

  return 'muted'
}

function personaTone(persona) {
  if (persona === 'VIP') {
    return 'info'
  }

  if (persona === 'High intent') {
    return 'accent'
  }

  if (persona === 'Warm') {
    return 'warning'
  }

  if (persona === 'Hesitant') {
    return 'accent'
  }

  return 'muted'
}

export default function OverviewPage() {
  const { metricCards, trendData, personaBreakdown, actionDistribution, recentRecommendations, activityFeed, loading, refresh, refreshedAt } = useDashboardSnapshot()
  const [activeFilter, setActiveFilter] = useState('all')

  const visibleRecommendations =
    activeFilter === 'critical'
      ? recentRecommendations.filter((row) => row.urgency === 'Critical')
      : activeFilter === 'converted'
        ? recentRecommendations.filter((row) => row.converted)
        : recentRecommendations

  const columns = [
    {
      key: 'userId',
      label: 'User',
      render: (row) => (
        <div>
          <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{row.userId}</div>
          <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{row.id}</div>
        </div>
      ),
    },
    {
      key: 'persona',
      label: 'Persona',
      render: (row) => <Badge tone={personaTone(row.persona)}>{row.persona}</Badge>,
    },
    {
      key: 'sentiment',
      label: 'Sentiment',
      render: (row) => <Badge tone={sentimentTone(row.sentiment)}>{row.sentiment}</Badge>,
    },
    {
      key: 'action',
      label: 'Action',
      render: (row) => <span className="font-medium text-slate-700 dark:text-slate-200">{row.action}</span>,
    },
    {
      key: 'channel',
      label: 'Channel',
      render: (row) => <Badge tone="muted">{row.channel}</Badge>,
    },
    {
      key: 'urgency',
      label: 'Urgency',
      render: (row) => <Badge tone={urgencyTone(row.urgency)}>{row.urgency}</Badge>,
    },
    {
      key: 'outcome',
      label: 'Outcome',
      render: (row) => (
        <Badge tone={row.converted ? 'success' : 'muted'}>{row.converted ? 'Converted' : 'Pending'}</Badge>
      ),
    },
  ]

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        eyebrow="Overview"
        title="Recommendation intelligence"
        description="Monitor recommendation performance, audience mix, and action outcomes in a single responsive workspace."
        actions={
          <>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-700"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <Link
              to="/feedback"
              className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-indigo-500 hover:shadow-lg"
            >
              Open feedback
              <ArrowRight className="h-4 w-4" />
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, index) => <MetricCardSkeleton key={index} />)
          : metricCards.map((metric) => <MetricCard key={metric.label} {...metric} loading={loading} />)}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <SectionCard
          title="Activity trend"
          description="Recommendation volume, conversions, and confidence over the last 7 days."
          actions={<Badge tone="info">Updated {formatDateTime(refreshedAt)}</Badge>}
        >
          {loading ? (
            <ChartSkeleton />
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 20,
                      border: '1px solid rgba(148,163,184,0.18)',
                      background: 'rgba(15,23,42,0.95)',
                      color: '#fff',
                    }}
                    labelStyle={{ color: '#cbd5e1' }}
                  />
                  <Area type="monotone" dataKey="recommendations" stroke="#4f46e5" fill="url(#trendFill)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="conversions" stroke="#22c55e" fill="transparent" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Persona split" description="How recommendation volume is distributed across audience segments.">
          {loading ? (
            <ChartSkeleton />
          ) : (
            <div className="space-y-6">
              <div className="mx-auto h-72 w-full max-w-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={personaBreakdown} dataKey="value" nameKey="name" innerRadius={74} outerRadius={108} paddingAngle={3}>
                      {personaBreakdown.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: 20,
                        border: '1px solid rgba(148,163,184,0.18)',
                        background: 'rgba(15,23,42,0.95)',
                        color: '#fff',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {personaBreakdown.map((segment) => (
                  <div key={segment.name} className="rounded-2xl border border-slate-200/80 px-4 py-3 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{segment.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-950 dark:text-white">{segment.value}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.55fr_0.95fr]">
        <SectionCard
          title="Recent recommendations"
          description="Filter by impact and track the current outcome for every suggestion."
          actions={
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
          }
        >
          <DataTable columns={columns} data={visibleRecommendations} loading={loading} skeletonRows={6} />
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title="Action distribution" description="The current mix of recommended next steps.">
            {loading ? (
              <ChartSkeleton />
            ) : (
              <div className="space-y-4">
                {actionDistribution.map((entry) => (
                  <div key={entry.name} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{entry.name}</span>
                      <span className="font-mono text-slate-500 dark:text-slate-400">{entry.value}%</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-900">
                      <div className="h-full rounded-full" style={{ width: `${entry.value}%`, backgroundColor: entry.color }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Activity feed" description="Recent platform events and workflow updates.">
            {loading ? (
              <ChartSkeleton />
            ) : (
              <div className="space-y-3">
                {activityFeed.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200/80 p-4 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{item.detail}</p>
                      </div>
                      <Badge tone={item.tone}>{item.tone}</Badge>
                    </div>
                    <p className="mt-3 font-mono text-xs text-slate-400 dark:text-slate-500">{formatDateTime(item.timestamp)}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}