import { useMemo, useState } from 'react'
import { Crown, Smile, Shield, UserRound, Zap, type LucideIcon } from 'lucide-react'
import { SectionCard } from '../SectionCard'
import { useAllDecisions } from '../../hooks/useDecisions'
import { cn } from '../../utils/cn.js'
import { formatActionType, getDecisionActionType, getDecisionUrgency } from '../../utils/decision'
import type { ActionUrgency, DecisionFilters, DecisionRecord, Persona, Sentiment } from '../../types/api'

export interface HeatmapSelection {
  persona: Persona
  sentiment: Sentiment
}

export interface PersonaSentimentHeatmapProps {
  activeSelection?: HeatmapSelection | null
  onCellSelect?: (selection: HeatmapSelection | null) => void
  className?: string
  filters?: DecisionFilters
}

type HeatmapCellUrgency = Record<ActionUrgency, number>

type HeatmapCell = {
  persona: Persona
  sentiment: Sentiment
  count: number
  urgencyCounts: HeatmapCellUrgency
  topActionTypes: Array<{ actionType: string; count: number }>
}

type HeatmapMatrix = Record<Persona, Record<Sentiment, HeatmapCell>>

const PERSONAS: Persona[] = ['Cold', 'Warm', 'High Intent', 'VIP', 'Hesitant']
const SENTIMENTS: Sentiment[] = ['Positive', 'Neutral', 'Negative']
const URGENCY_ORDER: ActionUrgency[] = ['critical', 'high', 'medium', 'low']

const personaToneMap: Record<Persona, { icon: LucideIcon; tone: string }> = {
  Cold: { icon: Shield, tone: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' },
  Warm: { icon: Smile, tone: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300' },
  'High Intent': { icon: Zap, tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  VIP: { icon: Crown, tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  Hesitant: { icon: UserRound, tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
}

const urgencyBadgeMap: Record<ActionUrgency, { label: string; className: string }> = {
  critical: { label: '🔴', className: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  high: { label: '🟠', className: 'bg-orange-500/10 text-orange-700 dark:text-orange-300' },
  medium: { label: '🟡', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  low: { label: '⚪', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
}

const sentimentHeaderTone: Record<Sentiment, string> = {
  Positive: 'text-emerald-600 dark:text-emerald-300',
  Neutral: 'text-slate-600 dark:text-slate-300',
  Negative: 'text-rose-600 dark:text-rose-300',
}

function getKey(persona: Persona, sentiment: Sentiment): string {
  return `${persona}::${sentiment}`
}

function buildEmptyCell(persona: Persona, sentiment: Sentiment): HeatmapCell {
  return {
    persona,
    sentiment,
    count: 0,
    urgencyCounts: { critical: 0, high: 0, medium: 0, low: 0 },
    topActionTypes: [],
  }
}

function getCellBackground(count: number, maxCount: number): { backgroundImage: string; color: string } {
  const ratio = maxCount > 0 ? count / maxCount : 0
  const intensity = count === 0 ? 0.04 : 0.12 + ratio * 0.78
  const textColor = ratio > 0.45 ? 'white' : 'rgb(15, 23, 42)'

  return {
    backgroundImage: `linear-gradient(135deg, rgba(99, 102, 241, ${intensity * 0.55}), rgba(79, 70, 229, ${intensity}))`,
    color: textColor,
  }
}

function compareTopActionTypes(left: { actionType: string; count: number }, right: { actionType: string; count: number }): number {
  if (right.count !== left.count) {
    return right.count - left.count
  }

  return left.actionType.localeCompare(right.actionType)
}

function aggregateDecisions(decisions: DecisionRecord[]): HeatmapMatrix {
  const matrix = PERSONAS.reduce((personaAcc, persona) => {
    personaAcc[persona] = SENTIMENTS.reduce((sentimentAcc, sentiment) => {
      sentimentAcc[sentiment] = buildEmptyCell(persona, sentiment)
      return sentimentAcc
    }, {} as Record<Sentiment, HeatmapCell>)

    return personaAcc
  }, {} as HeatmapMatrix)

  const actionCounts = new Map<string, Map<string, number>>()

  for (const decision of decisions) {
    const persona = decision.persona
    const sentiment = decision.sentiment

    if (!PERSONAS.includes(persona) || !SENTIMENTS.includes(sentiment)) {
      continue
    }

    const cell = matrix[persona][sentiment]
    const urgency = getDecisionUrgency(decision)
    const actionType = getDecisionActionType(decision)

    cell.count += 1
    cell.urgencyCounts[urgency] += 1

    const actionMap = actionCounts.get(getKey(persona, sentiment)) ?? new Map<string, number>()
    actionMap.set(actionType, (actionMap.get(actionType) ?? 0) + 1)
    actionCounts.set(getKey(persona, sentiment), actionMap)
  }

  for (const persona of PERSONAS) {
    for (const sentiment of SENTIMENTS) {
      const cell = matrix[persona][sentiment]
      const actionMap = actionCounts.get(getKey(persona, sentiment))

      if (!actionMap) {
        continue
      }

      cell.topActionTypes = Array.from(actionMap.entries())
        .map(([actionType, count]) => ({ actionType, count }))
        .sort(compareTopActionTypes)
        .slice(0, 3)
    }
  }

  return matrix
}

function getMaxCount(matrix: HeatmapMatrix): number {
  return PERSONAS.reduce((max, persona) => {
    return Math.max(
      max,
      ...SENTIMENTS.map((sentiment) => matrix[persona][sentiment].count),
    )
  }, 0)
}

function getTotalCriticalItems(matrix: HeatmapMatrix): number {
  return PERSONAS.reduce((sum, persona) => {
    return sum + SENTIMENTS.reduce((sentimentSum, sentiment) => sentimentSum + matrix[persona][sentiment].urgencyCounts.critical, 0)
  }, 0)
}

function getCellKey(cell: HeatmapCell): string {
  return getKey(cell.persona, cell.sentiment)
}

export function PersonaSentimentHeatmap({ activeSelection, onCellSelect, className = '', filters }: PersonaSentimentHeatmapProps) {
  const { data: decisions = [], isLoading, error } = useAllDecisions(filters)
  const [hoveredCellKey, setHoveredCellKey] = useState<string | null>(null)

  const matrix = useMemo(() => aggregateDecisions(decisions), [decisions])
  const maxCount = useMemo(() => getMaxCount(matrix), [matrix])
  const criticalCount = useMemo(() => getTotalCriticalItems(matrix), [matrix])

  const heatmapClassName = cn(
    'relative overflow-hidden',
    criticalCount > 0 && 'heatmap-critical-border',
    className,
  )

  return (
    <SectionCard
      title="Persona-Sentiment Heatmap"
      description="Interactive distribution of decisions across personas and sentiment states."
      className={heatmapClassName}
    >
      <style>{`
        @keyframes heatmap-critical-border {
          0%, 100% { box-shadow: 0 0 0 1px rgba(244, 63, 94, 0.18); }
          50% { box-shadow: 0 0 0 1px rgba(244, 63, 94, 0.42), 0 0 24px rgba(244, 63, 94, 0.12); }
        }

        .heatmap-critical-border {
          animation: heatmap-critical-border 1.8s ease-in-out infinite;
        }
      `}</style>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', criticalCount > 0 ? 'bg-rose-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-700')} />
          <span>{criticalCount > 0 ? `${criticalCount} critical item${criticalCount === 1 ? '' : 's'} detected` : 'No critical items detected'}</span>
        </div>

        <div className="text-xs uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
          Click a cell to filter the activity stream
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: PERSONAS.length }).map((_, rowIndex) => (
            <div key={rowIndex} className="h-28 animate-pulse rounded-[22px] border border-slate-200/80 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
          Unable to load the heatmap right now.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="hidden grid-cols-[9rem,minmax(0,1fr)] gap-3 sm:grid">
            <div />
            <div className="grid grid-cols-3 gap-3">
              {SENTIMENTS.map((sentiment) => (
                <div
                  key={sentiment}
                  className={cn('rounded-2xl border border-slate-200/70 bg-white/70 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.24em] dark:border-slate-800 dark:bg-slate-950/60', sentimentHeaderTone[sentiment])}
                >
                  {sentiment}
                </div>
              ))}
            </div>
          </div>

          {PERSONAS.map((persona) => {
            const personaInfo = personaToneMap[persona]
            const PersonaIcon = personaInfo.icon

            return (
              <div key={persona} className="grid gap-3 rounded-[22px] border border-slate-200/80 bg-white/60 p-3 shadow-[0_10px_32px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950/40 sm:grid-cols-[9rem,minmax(0,1fr)] sm:items-stretch">
                <div className="flex items-center gap-3 rounded-[18px] border border-slate-200/70 bg-white/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/70 sm:flex-col sm:items-start sm:justify-center">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl', personaInfo.tone)}>
                    <PersonaIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-950 dark:text-white">{persona}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Persona row</div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {SENTIMENTS.map((sentiment) => {
                    const cell = matrix[persona][sentiment]
                    const cellKey = getCellKey(cell)
                    const isActive = activeSelection?.persona === persona && activeSelection?.sentiment === sentiment
                    const isHovered = hoveredCellKey === cellKey
                    const backgroundStyle = getCellBackground(cell.count, maxCount)
                    const hasCritical = cell.urgencyCounts.critical > 0

                    return (
                      <button
                        key={cellKey}
                        type="button"
                        onClick={() => onCellSelect?.(isActive ? null : { persona, sentiment })}
                        onMouseEnter={() => setHoveredCellKey(cellKey)}
                        onMouseLeave={() => setHoveredCellKey(null)}
                        onFocus={() => setHoveredCellKey(cellKey)}
                        onBlur={() => setHoveredCellKey(null)}
                        className={cn(
                          'relative min-h-[8.5rem] overflow-visible rounded-[20px] border px-4 py-4 text-left shadow-[0_10px_28px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(15,23,42,0.1)] focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:shadow-[0_12px_32px_rgba(0,0,0,0.25)]',
                          isActive && 'ring-2 ring-indigo-500/60',
                          hasCritical && 'border-rose-500/30',
                        )}
                        style={backgroundStyle}
                        title={`${persona} / ${sentiment}: ${cell.count} decisions`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className={cn('text-sm font-semibold uppercase tracking-[0.22em]', backgroundStyle.color === 'white' ? 'text-white/90' : 'text-slate-950 dark:text-white')}>
                              {sentiment}
                            </div>
                            <div className={cn('mt-2 text-3xl font-semibold tracking-tight tabular-nums', backgroundStyle.color === 'white' ? 'text-white' : 'text-slate-950 dark:text-white')}>
                              {cell.count}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1">
                            {URGENCY_ORDER.map((urgency) => {
                              const count = cell.urgencyCounts[urgency]

                              if (count <= 0) {
                                return null
                              }

                              return (
                                <span
                                  key={urgency}
                                  className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold', urgencyBadgeMap[urgency].className)}
                                >
                                  <span>{urgencyBadgeMap[urgency].label}</span>
                                  <span>{count}</span>
                                </span>
                              )
                            })}
                          </div>
                        </div>

                        <div className={cn('mt-4 flex flex-wrap gap-2', backgroundStyle.color === 'white' ? 'text-white' : 'text-slate-700 dark:text-slate-200')}>
                          {cell.topActionTypes.length > 0 ? (
                            cell.topActionTypes.map((action) => (
                              <span key={action.actionType} className="inline-flex rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm dark:bg-slate-950/30">
                                {formatActionType(action.actionType)} · {action.count}
                              </span>
                            ))
                          ) : (
                            <span className="text-[11px] font-medium opacity-80">No decisions yet</span>
                          )}
                        </div>

                        <div
                          className={cn(
                            'pointer-events-none absolute left-1/2 top-0 z-20 w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-[calc(100%+0.75rem)] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 opacity-0 shadow-2xl transition duration-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200',
                            isHovered && 'opacity-100',
                          )}
                        >
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                            Top action types
                          </div>
                          <div className="space-y-1.5">
                            {cell.topActionTypes.length > 0 ? (
                              cell.topActionTypes.map((action) => (
                                <div key={action.actionType} className="flex items-center justify-between gap-3">
                                  <span className="truncate">{formatActionType(action.actionType)}</span>
                                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">{action.count}</span>
                                </div>
                              ))
                            ) : (
                              <div>No decisions in this cell yet.</div>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          <div className="flex flex-col gap-3 rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/40 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-slate-600 dark:text-slate-300">Legend</div>
            <div className="flex flex-1 items-center gap-3">
              <div className="h-3 flex-1 rounded-full bg-gradient-to-r from-indigo-100 via-indigo-400 to-indigo-700 dark:from-indigo-950 dark:via-indigo-700 dark:to-indigo-400" />
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span>Low</span>
                <span>•</span>
                <span>High</span>
              </div>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Cell intensity scales with decision count
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

export default PersonaSentimentHeatmap