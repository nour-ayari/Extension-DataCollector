import type { ActionType, ActionUrgency, DecisionRecord } from '../types/api'

export function getDecisionTimestamp(decision: DecisionRecord): string {
  return decision.created_at ?? decision.updated_at ?? ''
}

export function getDecisionUrgency(decision: DecisionRecord): ActionUrgency {
  return (decision.urgency ?? decision.action?.urgency ?? 'low').toLowerCase() as ActionUrgency
}

export function getDecisionActionType(decision: DecisionRecord): ActionType | string {
  return decision.action_type ?? decision.action?.action_type ?? 'unknown_action'
}

export function isConverted(decision: DecisionRecord): boolean {
  const status = decision.status?.trim().toLowerCase()
  return Boolean(decision.converted) || status === 'converted' || status === 'completed' || status === 'success'
}

export function formatActionType(actionType: string): string {
  return actionType
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

export function getDecisionKey(decision: DecisionRecord): string {
  return (
    decision.id ??
    decision.decision_id ??
    `${decision.user_id}-${getDecisionTimestamp(decision) || getDecisionActionType(decision)}`
  )
}

export function mergeDecisions(...groups: DecisionRecord[][]): DecisionRecord[] {
  const deduped = new Map<string, DecisionRecord>()

  for (const group of groups) {
    for (const decision of group) {
      deduped.set(getDecisionKey(decision), decision)
    }
  }

  return Array.from(deduped.values()).sort(
    (a, b) =>
      new Date(getDecisionTimestamp(b) || 0).getTime() -
      new Date(getDecisionTimestamp(a) || 0).getTime(),
  )
}
