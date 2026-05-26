import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { fetchAllDecisions, fetchRecommendation } from '../services/api'
import { notify } from '../services/notifications'
import type {
  ActionType,
  ActionUrgency,
  DashboardDateRange,
  DecisionDetails,
  DecisionFilters,
  DecisionRecord,
  DecisionStats,
  Persona,
  Sentiment,
} from '../types/api'

export interface QueryState<T> {
  data: T | undefined
  isLoading: boolean
  error: Error | null
  refetch: UseQueryResult<T, Error>['refetch']
}

const DEFAULT_STALE_TIME = 5_000
const DEFAULT_GC_TIME = 60_000
const RECOMMENDATION_STALE_TIME = 15_000
const RECOMMENDATION_GC_TIME = 5 * 60_000
const CRITICAL_POLL_INTERVAL = 5_000
const CRITICAL_STALE_TIME = 2_000
const CRITICAL_GC_TIME = 30_000
const notifiedErrors = new Set<string>()

function asArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) {
    return undefined
  }

  return Array.isArray(value) ? value : [value]
}

function normalizeArray<T extends string>(values: T[] | undefined): T[] | undefined {
  if (!values || values.length === 0) {
    return undefined
  }

  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString().slice(0, 10)
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

function getDecisionTimestamp(decision: DecisionRecord): string | undefined {
  return decision.created_at ?? decision.updated_at ?? undefined
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim()
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue.toLowerCase() : undefined
}

function getDecisionUrgency(decision: DecisionRecord): ActionUrgency | undefined {
  return decision.urgency ?? decision.action?.urgency
}

function getDecisionActionType(decision: DecisionRecord): ActionType | undefined {
  return decision.action_type ?? decision.action?.action_type
}

function getDecisionPersona(decision: DecisionRecord): Persona {
  return decision.persona
}

function getDecisionSentiment(decision: DecisionRecord): Sentiment {
  return decision.sentiment
}

function getDateRangeBounds(filters: DecisionFilters): { start?: number; end?: number } {
  if (filters.dateRange === 'custom') {
    const startDate = normalizeDate(filters.startDate)
    const endDate = normalizeDate(filters.endDate)

    return {
      start: startDate ? new Date(startDate).getTime() : undefined,
      end: endDate ? new Date(endDate).getTime() + 86_399_999 : undefined,
    }
  }

  if (filters.dateRange) {
    return { start: getDateRangeStart(filters.dateRange).getTime() }
  }

  const startDate = normalizeDate(filters.startDate)
  const endDate = normalizeDate(filters.endDate)

  return {
    start: startDate ? new Date(startDate).getTime() : undefined,
    end: endDate ? new Date(endDate).getTime() + 86_399_999 : undefined,
  }
}

function getFilterValues<T extends string>(primary: T | T[] | undefined, secondary: T[] | undefined): T[] | undefined {
  return normalizeArray([...(asArray(primary) ?? []), ...(secondary ?? [])])
}

function matchesFilters(decision: DecisionRecord, filters: DecisionFilters): boolean {
  const personaValues = getFilterValues(filters.persona, filters.personas)
  if (personaValues && !personaValues.includes(getDecisionPersona(decision))) {
    return false
  }

  const sentimentValues = getFilterValues(filters.sentiment, filters.sentiments)
  if (sentimentValues && !sentimentValues.includes(getDecisionSentiment(decision))) {
    return false
  }

  const urgencyValues = getFilterValues(filters.urgency, filters.urgencies)
  const urgency = getDecisionUrgency(decision)
  if (urgencyValues && (!urgency || !urgencyValues.includes(urgency))) {
    return false
  }

  const actionTypeValues = getFilterValues(filters.actionType, filters.actionTypes)
  const actionType = getDecisionActionType(decision)
  if (actionTypeValues && (!actionType || !actionTypeValues.includes(actionType))) {
    return false
  }

  if (filters.converted !== undefined && Boolean(decision.converted) !== filters.converted) {
    return false
  }

  const userId = normalizeText(filters.userId)
  if (userId && !normalizeText(decision.user_id)?.includes(userId)) {
    return false
  }

  const search = normalizeText(filters.search)
  if (!search) {
    const { start, end } = getDateRangeBounds(filters)
    const timestamp = getDecisionTimestamp(decision)

    if (!timestamp) {
      return false
    }

    const decisionTime = new Date(timestamp).getTime()
    if (start !== undefined && decisionTime < start) {
      return false
    }

    if (end !== undefined && decisionTime > end) {
      return false
    }

    return true
  }

  const searchableText = [
    decision.user_id,
    decision.persona,
    decision.sentiment,
    decision.action?.description,
    decision.action?.trigger_cond,
    decision.description,
    decision.trigger_cond,
    decision.reasoning,
    decision.recommendation,
    decision.action_type,
    decision.urgency,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase()

  if (!searchableText.includes(search)) {
    return false
  }

  const { start, end } = getDateRangeBounds(filters)
  const timestamp = getDecisionTimestamp(decision)

  if (!timestamp) {
    return false
  }

  const decisionTime = new Date(timestamp).getTime()
  if (start !== undefined && decisionTime < start) {
    return false
  }

  if (end !== undefined && decisionTime > end) {
    return false
  }

  return true
}

function buildDecisionStats(decisions: DecisionRecord[]): DecisionStats {
  const byPersona: Record<Persona, number> = {
    Cold: 0,
    Warm: 0,
    'High Intent': 0,
    VIP: 0,
    Hesitant: 0,
  }

  const bySentiment: Record<Sentiment, number> = {
    Positive: 0,
    Neutral: 0,
    Negative: 0,
  }

  const byUrgency: Record<ActionUrgency, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  }

  const byActionType: Partial<Record<ActionType, number>> = {}

  let criticalDecisions = 0
  let convertedDecisions = 0
  let confidenceTotal = 0
  let confidenceCount = 0

  for (const decision of decisions) {
    const persona = getDecisionPersona(decision)
    const sentiment = getDecisionSentiment(decision)
    const urgency = getDecisionUrgency(decision)
    const actionType = getDecisionActionType(decision)

    byPersona[persona] += 1
    bySentiment[sentiment] += 1

    if (urgency) {
      byUrgency[urgency] += 1
      if (urgency === 'critical') {
        criticalDecisions += 1
      }
    }

    if (actionType) {
      byActionType[actionType] = (byActionType[actionType] ?? 0) + 1
    }

    if (decision.converted) {
      convertedDecisions += 1
    }

    if (typeof decision.confidence === 'number' && Number.isFinite(decision.confidence)) {
      confidenceTotal += decision.confidence
      confidenceCount += 1
    }
  }

  const totalDecisions = decisions.length

  return {
    totalDecisions,
    criticalDecisions,
    convertedDecisions,
    conversionRate: totalDecisions > 0 ? convertedDecisions / totalDecisions : 0,
    averageConfidence: confidenceCount > 0 ? confidenceTotal / confidenceCount : 0,
    byPersona,
    bySentiment,
    byUrgency,
    byActionType,
  }
}

function getQueryError(error: unknown): Error | null {
  return error instanceof Error ? error : error ? new Error(String(error)) : null
}

function getQueryState<T>(query: UseQueryResult<T, Error>): QueryState<T> {
  return {
    data: query.data,
    isLoading: query.isLoading,
    error: getQueryError(query.error),
    refetch: query.refetch,
  }
}

export function useRecommendation(userId: string): QueryState<DecisionRecord> {
  const trimmedUserId = userId.trim()

  const query = useQuery({
    queryKey: ['recommendation', trimmedUserId],
    queryFn: async () => {
      const response = await fetchRecommendation(trimmedUserId)
      return response.agent3_output as DecisionRecord
    },
    enabled: trimmedUserId.length > 0,
    staleTime: RECOMMENDATION_STALE_TIME,
    gcTime: RECOMMENDATION_GC_TIME,
  })

  return getQueryState(query)
}

export function useAllDecisions(filters?: DecisionFilters): QueryState<DecisionRecord[]> {
  const normalizedFilters = useMemo(() => {
    if (!filters) {
      return undefined
    }

    return {
      userId: normalizeText(filters.userId),
      persona: normalizeArray(asArray(filters.persona) ?? filters.personas),
      sentiment: normalizeArray(asArray(filters.sentiment) ?? filters.sentiments),
      actionType: normalizeArray(asArray(filters.actionType) ?? filters.actionTypes),
      urgency: normalizeArray(asArray(filters.urgency) ?? filters.urgencies),
      dateRange: filters.dateRange,
      startDate: normalizeDate(filters.startDate),
      endDate: normalizeDate(filters.endDate),
      converted: filters.converted,
      search: normalizeText(filters.search),
    }
  }, [filters])

  const query = useQuery({
    queryKey: ['decisions', 'all', normalizedFilters ?? {}],
    queryFn: fetchAllDecisions,
    select: (decisions) => {
      if (!filters) {
        return decisions
      }

      return decisions.filter((decision) => matchesFilters(decision, filters))
    },
    staleTime: DEFAULT_STALE_TIME,
    gcTime: DEFAULT_GC_TIME,
  })

  useEffect(() => {
    if (!query.error) {
      return
    }

    const message = query.error.message || 'Unable to load decisions.'
    if (notifiedErrors.has(message)) {
      return
    }

    notifiedErrors.add(message)
    notify.error(message, { source: 'decision-query' })
  }, [query.error])

  return getQueryState(query)
}

export function useDecisionById(id: string): QueryState<DecisionDetails | undefined> {
  const trimmedId = id.trim()

  const query = useQuery({
    queryKey: ['decision', trimmedId],
    queryFn: fetchAllDecisions,
    select: (decisions) => {
      if (!trimmedId) {
        return undefined
      }

      return decisions.find((decision) => {
        const decisionId = decision.id ?? decision.decision_id ?? ''
        return decisionId === trimmedId
      }) as DecisionDetails | undefined
    },
    enabled: trimmedId.length > 0,
    staleTime: DEFAULT_STALE_TIME,
    gcTime: DEFAULT_GC_TIME,
  })

  useEffect(() => {
    if (!query.error) {
      return
    }

    const message = query.error.message || 'Unable to load decision details.'
    if (notifiedErrors.has(message)) {
      return
    }

    notifiedErrors.add(message)
    notify.error(message, { source: 'decision-details' })
  }, [query.error])

  return getQueryState(query)
}

export function useCriticalDecisions(): QueryState<DecisionRecord[]> {
  const query = useQuery({
    queryKey: ['decisions', 'critical'],
    queryFn: fetchAllDecisions,
    select: (decisions) => decisions.filter((decision) => getDecisionUrgency(decision) === 'critical'),
    staleTime: CRITICAL_STALE_TIME,
    gcTime: CRITICAL_GC_TIME,
    refetchInterval: CRITICAL_POLL_INTERVAL,
    refetchIntervalInBackground: true,
  })

  return getQueryState(query)
}

export function useDecisionStats(): QueryState<DecisionStats> {
  const query = useQuery({
    queryKey: ['decision-stats'],
    queryFn: fetchAllDecisions,
    select: buildDecisionStats,
    staleTime: DEFAULT_STALE_TIME,
    gcTime: DEFAULT_GC_TIME,
  })

  return getQueryState(query)
}