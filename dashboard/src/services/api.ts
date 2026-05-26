import type {
  ActionChannel,
  ActionType,
  ActionUrgency,
  DecisionRecord,
  PredictionApiResponse,
} from '../types/api'

type ApiEnv = ImportMetaEnv & {
  readonly VITE_API_BASE_URL?: string
}

const env = import.meta.env as ApiEnv

export const apiBaseUrl = getApiBaseUrl()

function getApiBaseUrl(): string {
  return (env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
}

function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath
}

async function readErrorMessage(response: Response): Promise<string> {
  const rawBody = await response.text()

  if (rawBody.trim().length === 0) {
    return response.statusText || `HTTP ${response.status}`
  }

  try {
    const parsedBody = JSON.parse(rawBody) as Record<string, unknown>
    const detail = parsedBody.detail ?? parsedBody.message ?? parsedBody.error

    if (typeof detail === 'string' && detail.trim().length > 0) {
      return detail
    }

    return rawBody
  } catch {
    return rawBody
  }
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const message = await readErrorMessage(response)
    throw new Error(`Request failed with ${response.status} ${response.statusText}: ${message}`)
  }

  return (await response.json()) as T
}

function normalizeLogToDecision(raw: Record<string, unknown>): DecisionRecord {
  const urgency =
    typeof raw.urgency === 'string' ? (raw.urgency.toLowerCase() as ActionUrgency) : undefined

  return {
    ...raw,
    id: raw.id != null ? String(raw.id) : undefined,
    decision_id: raw.id != null ? String(raw.id) : undefined,
    urgency,
    reasoning:
      (raw.rationale as string | undefined) ?? (raw.reasoning as string | undefined),
    description:
      (raw.subject_line as string | undefined) ?? (raw.description as string | undefined),
    recommendation:
      (raw.body_copy as string | undefined) ?? (raw.recommendation as string | undefined),
    converted: raw.converted === true,
    action: raw.action_type
      ? {
          action_type: raw.action_type as ActionType,
          channel: (raw.channel as ActionChannel) ?? 'email',
          urgency: urgency ?? 'low',
          description: (raw.subject_line as string) ?? '',
          trigger_cond: (raw.trigger_cond as string) ?? '',
        }
      : undefined,
  } as DecisionRecord
}

export async function fetchAllDecisions(): Promise<DecisionRecord[]> {
  try {
    const rows = await requestJson<Record<string, unknown>[]>('/logs?limit=500')
    return rows.map(normalizeLogToDecision)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to fetch decisions: ${message}`)
  }
}

export async function fetchRecommendation(userId: string): Promise<PredictionApiResponse> {
  const trimmedUserId = userId.trim()

  if (trimmedUserId.length === 0) {
    throw new Error('userId is required')
  }

  try {
    const rows = await requestJson<Record<string, unknown>[]>(
      `/logs?user_id=${encodeURIComponent(trimmedUserId)}&limit=1`,
    )

    if (rows.length === 0) {
      throw new Error(`No recommendation found for user "${trimmedUserId}"`)
    }

    const decision = normalizeLogToDecision(rows[0])
    return {
      agent1: {} as never,
      agent2: {} as never,
      agent3_output: decision as never,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to fetch recommendation for user "${trimmedUserId}": ${message}`)
  }
}
