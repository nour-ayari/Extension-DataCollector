import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Clock3,
  FileJson,
  Layers3,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useDecisionById } from '../../hooks/useDecisions'
import { cn } from '../../utils/cn.js'
import { formatConfidence } from '../../utils/format.js'
import { formatActionType } from '../../utils/decision'
import type { DecisionDetails, DecisionRecord, Persona, Sentiment } from '../../types/api'

export interface DecisionDetailPanelProps {
  decisionId: string
  onClose: () => void
}

type SectionKey = 'overview' | 'path' | 'context' | 'reasoning' | 'actions'

const sectionLabels: Record<SectionKey, string> = {
  overview: 'Decision Overview',
  path: 'Decision Path',
  context: 'User Context',
  reasoning: 'LLM Reasoning',
  actions: 'Actions',
}

const USER_META_FIELD_ORDER: Array<{ group: string; field: string; keys: string[] }> = [
  { group: 'RFM', field: 'Recency days', keys: ['recency_days', 'recency'] },
  { group: 'RFM', field: 'Frequency', keys: ['frequency'] },
  { group: 'RFM', field: 'Monetary', keys: ['monetary'] },
  { group: 'RFM', field: 'RFM score', keys: ['rfm', 'rfm_score', 'rfmScore'] },
  { group: 'Behavior', field: 'Scroll depth', keys: ['avg_scroll_depth', 'scroll_depth', 'scrollDepth'] },
  { group: 'Behavior', field: 'Clicks', keys: ['avg_clicks', 'clicks'] },
  { group: 'Behavior', field: 'Bounce rate', keys: ['bounce_rate', 'bounceRate'] },
  { group: 'Behavior', field: 'Session duration', keys: ['avg_session_duration', 'session_duration', 'sessionDuration'] },
  { group: 'Behavior', field: 'Checkout rate', keys: ['checkout_rate', 'checkoutRate'] },
  { group: 'Behavior', field: 'Purchase rate', keys: ['purchase_rate', 'purchaseRate'] },
  { group: 'Behavior', field: 'Cart abandonment', keys: ['cart_abandonment_rate', 'cartAbandonmentRate'] },
  { group: 'Behavior', field: 'Max funnel depth', keys: ['max_funnel_depth', 'maxFunnelDepth'] },
  { group: 'Device', field: 'Device', keys: ['device_mode', 'device'] },
  { group: 'Device', field: 'Region', keys: ['region'] },
  { group: 'Device', field: 'Preferred source', keys: ['preferred_source', 'source'] },
  { group: 'Profile', field: 'Age', keys: ['age'] },
  { group: 'Profile', field: 'Gender', keys: ['gender'] },
]

const PERSONA_ORDER: Persona[] = ['Cold', 'Warm', 'High Intent', 'VIP', 'Hesitant']
const SENTIMENT_ORDER: Sentiment[] = ['Positive', 'Neutral', 'Negative']

function formatTimestamp(value?: string): string {
  if (!value) {
    return 'Unknown'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date)
}

function normalizeActionType(actionType?: string): string {
  if (!actionType) {
    return 'Unknown Action'
  }

  return formatActionType(actionType)
}

function getDecisionConfidence(decision: DecisionDetails | undefined): number {
  const confidence = decision?.confidence ?? decision?.agent3_output?.confidence ?? 0
  return confidence > 1 ? confidence / 100 : confidence
}

function getDecisionUserId(decision: DecisionDetails | undefined): string {
  return decision?.user_id ?? decision?.agent3_output?.user_id ?? 'Unknown user'
}

function getDecisionTimestamp(decision: DecisionDetails | undefined): string | undefined {
  return decision?.created_at ?? decision?.updated_at ?? decision?.agent3_output?.created_at
}

function getDecisionActionType(decision: DecisionDetails | undefined): string {
  return decision?.action_type ?? decision?.action?.action_type ?? decision?.agent3_output?.action?.action_type ?? 'unknown_action'
}

function getDecisionPersona(decision: DecisionDetails | undefined): Persona {
  return decision?.persona ?? decision?.agent3_output?.persona ?? 'Warm'
}

function getDecisionSentiment(decision: DecisionDetails | undefined): Sentiment {
  return decision?.sentiment ?? decision?.agent3_output?.sentiment ?? 'Neutral'
}

function getRuleTrace(decision: DecisionDetails | undefined): string {
  const persona = getDecisionPersona(decision)
  const sentiment = getDecisionSentiment(decision)
  return `${persona} × ${sentiment} → ${normalizeActionType(getDecisionActionType(decision))}`
}

function normalizeConfidence(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  return formatConfidence(value > 1 ? value / 100 : value)
}

function getAgent1Summary(agent1: DecisionDetails['agent1']) {
  const intent = agent1?.intent ?? {}
  const sentiment = agent1?.sentiment ?? {}
  const intentLabel = intent.label ?? intent.category ?? intent.name ?? intent.intent ?? 'N/A'
  const churnRisk = intent.churn_risk ?? intent.churnRisk ?? intent.risk ?? 'N/A'

  return {
    intentLabel: String(intentLabel),
    confidence: normalizeConfidence(agent1?.confidence ?? intent.confidence ?? sentiment.confidence),
    sentimentLabel: String(sentiment.label ?? sentiment.value ?? sentiment.sentiment ?? getDecisionSentiment(undefined)),
    churnRisk: normalizeConfidence(churnRisk) || String(churnRisk),
  }
}

function getAgent2Rfm(decision: DecisionDetails | undefined): Array<{ label: string; value: string }> {
  const userMeta = decision?.user_meta ?? {}

  return [
    { label: 'Persona assignment', value: decision?.agent2?.persona ?? getDecisionPersona(decision) },
    { label: 'Recency', value: String(userMeta.recency_days ?? userMeta.recency ?? 'N/A') },
    { label: 'Frequency', value: String(userMeta.frequency ?? 'N/A') },
    { label: 'Monetary', value: String(userMeta.monetary ?? 'N/A') },
  ]
}

function buildContextRows(decision: DecisionDetails | undefined): Array<{ group: string; field: string; value: string }> {
  const userMeta = decision?.user_meta ?? {}
  const rows: Array<{ group: string; field: string; value: string }> = []
  const knownKeys = new Set<string>(USER_META_FIELD_ORDER.flatMap((entry) => entry.keys))

  for (const entry of USER_META_FIELD_ORDER) {
    const rawValue = entry.keys.map((key) => userMeta[key]).find((value) => value !== undefined && value !== null && value !== '')
    if (rawValue !== undefined) {
      rows.push({ group: entry.group, field: entry.field, value: String(rawValue) })
    }
  }

  for (const [key, value] of Object.entries(userMeta)) {
    if (knownKeys.has(key) || value === undefined || value === null || value === '') {
      continue
    }

    rows.push({ group: 'Other', field: key, value: String(value) })
  }

  return rows
}

function getPersonaLabel(decision: DecisionDetails | undefined): string {
  return getDecisionPersona(decision)
}

export function DecisionDetailPanel({ decisionId, onClose }: DecisionDetailPanelProps) {
  const { data: decision, isLoading, error, refetch } = useDecisionById(decisionId)
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [reviewed, setReviewed] = useState(false)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setIsOpen(true))
    return () => window.cancelAnimationFrame(frameId)
  }, [decisionId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        requestClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const requestClose = () => {
    setIsOpen(false)
    window.setTimeout(() => onClose(), 180)
  }

  const copyPayload = useMemo(() => JSON.stringify(decision ?? { decisionId }, null, 2), [decision, decisionId])
  const confidenceScore = getDecisionConfidence(decision)
  const agent1Summary = getAgent1Summary(decision?.agent1)
  const contextRows = buildContextRows(decision)
  const agent2Rfm = getAgent2Rfm(decision)

  const handleCopyJson = async () => {
    await navigator.clipboard.writeText(copyPayload)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-[2px] transition-opacity duration-200',
        isOpen ? 'opacity-100' : 'opacity-0',
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose()
        }
      }}
      aria-hidden={!isOpen}
    >
      <aside
        className={cn(
          'flex h-full w-full max-w-[52rem] flex-col border-l border-slate-200 bg-slate-50 shadow-[0_24px_80px_rgba(15,23,42,0.28)] transition-transform duration-300 dark:border-slate-800 dark:bg-slate-950',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="decision-detail-title"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">Decision Detail</p>
            <h2 id="decision-detail-title" className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Decision-making process
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Detailed breakdown for a single AI recommendation.</p>
          </div>

          <button
            type="button"
            onClick={requestClose}
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isLoading ? (
            <div className="space-y-4">
              <div className="h-24 animate-pulse rounded-[24px] bg-slate-200/70 dark:bg-slate-800/70" />
              <div className="h-44 animate-pulse rounded-[24px] bg-slate-200/70 dark:bg-slate-800/70" />
              <div className="h-36 animate-pulse rounded-[24px] bg-slate-200/70 dark:bg-slate-800/70" />
            </div>
          ) : error || !decision ? (
            <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
              Unable to load the decision details.
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <details open className="group rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950/70">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-950 dark:text-white">{sectionLabels.overview}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Key facts about the final recommendation</div>
                  </div>
                  <ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" />
                </summary>

                <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)]">
                  <div className="space-y-4 rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">User ID</div>
                        <div className="mt-1 font-mono text-sm text-slate-950 dark:text-white">{getDecisionUserId(decision)}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Timestamp</div>
                        <div className="mt-1 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                          <Clock3 className="h-4 w-4" />
                          <span>{formatTimestamp(getDecisionTimestamp(decision))}</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Final action recommended</div>
                        <div className="mt-1 text-sm font-medium text-slate-950 dark:text-white">{normalizeActionType(getDecisionActionType(decision))}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Status</div>
                        <div className="mt-1 inline-flex rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                          {reviewed ? 'Reviewed' : 'Ready for review'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                      <span>Confidence score</span>
                      <span className="font-mono text-slate-950 dark:text-white">{formatConfidence(confidenceScore)}</span>
                    </div>
                    <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-500 transition-all duration-500"
                        style={{ width: `${Math.round(confidenceScore * 100)}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Confidence is normalized to the 0-100% range.</div>
                  </div>
                </div>
              </details>

              <details open className="group rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950/70">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-950 dark:text-white">{sectionLabels.path}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">How Agent 1, 2, and 3 produced the recommendation</div>
                  </div>
                  <ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" />
                </summary>

                <div className="mt-5 space-y-4">
                  <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-stretch">
                    <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        <Sparkles className="h-4 w-4" />
                        Agent 1 Output
                      </div>
                      <div className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                        <div><span className="text-slate-500 dark:text-slate-400">Intent:</span> {agent1Summary.intentLabel}</div>
                        <div><span className="text-slate-500 dark:text-slate-400">Confidence:</span> {agent1Summary.confidence}</div>
                        <div><span className="text-slate-500 dark:text-slate-400">Sentiment:</span> {agent1Summary.sentimentLabel}</div>
                        <div><span className="text-slate-500 dark:text-slate-400">Churn risk:</span> {agent1Summary.churnRisk}</div>
                      </div>
                    </div>

                    <div className="hidden items-center justify-center lg:flex">
                      <ChevronRight className="h-6 w-6 text-slate-300 dark:text-slate-700" />
                    </div>

                    <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        <Layers3 className="h-4 w-4" />
                        Agent 2 Output
                      </div>
                      <div className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                        <div><span className="text-slate-500 dark:text-slate-400">Persona assignment:</span> {decision.agent2?.persona ?? getDecisionPersona(decision)}</div>
                        {decision.agent2?.confidence !== undefined ? (
                          <div><span className="text-slate-500 dark:text-slate-400">Confidence:</span> {normalizeConfidence(decision.agent2.confidence)}</div>
                        ) : null}
                        <div className="grid gap-2 pt-1 sm:grid-cols-2">
                          {agent2Rfm.map((item) => (
                            <div key={item.label} className="rounded-2xl bg-white px-3 py-2 text-sm shadow-sm dark:bg-slate-950/70">
                              <div className="text-xs uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">{item.label}</div>
                              <div className="mt-1 font-medium text-slate-950 dark:text-white">{item.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="hidden items-center justify-center lg:flex">
                      <ChevronRight className="h-6 w-6 text-slate-300 dark:text-slate-700" />
                    </div>

                    <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        <FileJson className="h-4 w-4" />
                        Agent 3 Output
                      </div>
                      <div className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                        <div><span className="text-slate-500 dark:text-slate-400">Rule matched:</span> {getRuleTrace(decision)}</div>
                        <div><span className="text-slate-500 dark:text-slate-400">Channel:</span> {String(decision.agent3_output?.action?.channel ?? decision.action?.channel ?? 'N/A')}</div>
                        <div><span className="text-slate-500 dark:text-slate-400">Urgency:</span> {String(decision.agent3_output?.action?.urgency ?? decision.action?.urgency ?? 'N/A')}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                      <span>Rule trace</span>
                      <span>•</span>
                      <span>{getPersonaLabel(decision)} × {getDecisionSentiment(decision)} → {normalizeActionType(getDecisionActionType(decision))}</span>
                    </div>
                  </div>
                </div>
              </details>

              <details className="group rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950/70">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-950 dark:text-white">{sectionLabels.context}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Key user signals used by the model</div>
                  </div>
                  <ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" />
                </summary>

                <div className="mt-5 overflow-hidden rounded-[20px] border border-slate-200/80 dark:border-slate-800">
                  <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                    <thead className="bg-slate-50 dark:bg-slate-900/60">
                      <tr className="text-left text-xs uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                        <th className="px-4 py-3 font-semibold">Group</th>
                        <th className="px-4 py-3 font-semibold">Field</th>
                        <th className="px-4 py-3 font-semibold">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-950/70">
                      {contextRows.length > 0 ? contextRows.map((row) => (
                        <tr key={`${row.group}-${row.field}`} className="align-top">
                          <td className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">{row.group}</td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{row.field}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-950 dark:text-white">{row.value}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td className="px-4 py-4 text-sm text-slate-500 dark:text-slate-400" colSpan={3}>
                            No user context metadata available.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </details>

              <details className="group rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950/70">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-950 dark:text-white">{sectionLabels.reasoning}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">What the model generated for the user</div>
                  </div>
                  <ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" />
                </summary>

                <div className="mt-5 space-y-4">
                  <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Recommendation message</div>
                    <div className="mt-2 whitespace-pre-wrap rounded-[16px] bg-white px-4 py-3 text-sm leading-6 text-slate-700 dark:bg-slate-950/70 dark:text-slate-200">
                      {decision.recommendation ?? decision.agent3_output?.recommendation ?? 'No recommendation message available.'}
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Reasoning / explanation</div>
                    <div className="mt-2 whitespace-pre-wrap rounded-[16px] bg-white px-4 py-3 text-sm leading-6 text-slate-700 dark:bg-slate-950/70 dark:text-slate-200">
                      {decision.reasoning ?? decision.agent3_output?.reasoning ?? 'No reasoning provided.'}
                    </div>
                  </div>
                </div>
              </details>

              <details open className="group rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950/70">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-950 dark:text-white">{sectionLabels.actions}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Quick actions for the current decision</div>
                  </div>
                  <ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" />
                </summary>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCopyJson()}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                  >
                    <ClipboardCopy className="h-4 w-4" />
                    {copied ? 'Copied' : 'Copy decision JSON'}
                  </button>

                  <button
                    type="button"
                    disabled
                    className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-400 opacity-70 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500"
                  >
                    <Sparkles className="h-4 w-4" />
                    Override decision
                  </button>

                  <button
                    type="button"
                    onClick={() => setReviewed(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200 dark:hover:bg-emerald-950/50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Mark as reviewed
                  </button>
                </div>
              </details>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

export default DecisionDetailPanel