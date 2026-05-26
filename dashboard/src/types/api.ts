export type Persona = 'Cold' | 'Warm' | 'High Intent' | 'VIP' | 'Hesitant'

export type Sentiment = 'Positive' | 'Neutral' | 'Negative'

export type ActionType =
  | 'review_ask'
  | 'welcome_offer'
  | 'chatbot_fix'
  | 'price_nudge'
  | 'nurture_email'
  | 'apology_offer'
  | 'upsell'
  | 'scarcity_push'
  | 'exit_overlay'
  | 'referral'
  | 'early_access'
  | 'human_call'
  | 'chatbot_guide'
  | 'trust_signals'
  | 'survey'

export type ActionChannel = 'email' | 'overlay' | 'chatbot' | 'alert' | 'sms'

export type ActionUrgency = 'low' | 'medium' | 'high' | 'critical'

export type DashboardDateRange = 'today' | '7d' | '30d' | 'custom'

export type JsonRecord = Record<string, unknown>

export interface DecisionFilters {
  userId?: string
  persona?: Persona | Persona[]
  personas?: Persona[]
  sentiment?: Sentiment | Sentiment[]
  sentiments?: Sentiment[]
  actionType?: ActionType | ActionType[]
  actionTypes?: ActionType[]
  urgency?: ActionUrgency | ActionUrgency[]
  urgencies?: ActionUrgency[]
  dateRange?: DashboardDateRange
  startDate?: string
  endDate?: string
  converted?: boolean
  search?: string
}

export interface DecisionStats {
  totalDecisions: number
  criticalDecisions: number
  convertedDecisions: number
  conversionRate: number
  averageConfidence: number
  byPersona: Record<Persona, number>
  bySentiment: Record<Sentiment, number>
  byUrgency: Record<ActionUrgency, number>
  byActionType: Partial<Record<ActionType, number>>
}

export interface DecisionActionTemplate {
  action_type: ActionType
  channel: ActionChannel
  urgency: ActionUrgency
  description: string
  trigger_cond: string
}

export interface Agent1Output {
  record_id: string
  intent: JsonRecord
  sentiment: JsonRecord
  confidence?: number
  [key: string]: unknown
}

export interface Agent2Output {
  persona: Persona
  sentiment: Sentiment
  action_type: ActionType
  channel?: ActionChannel
  urgency?: ActionUrgency
  description?: string
  trigger_cond?: string
  action?: DecisionActionTemplate
  confidence?: number
  reasoning?: string
  recommendation?: string
  [key: string]: unknown
}

export interface Agent3Output {
  user_id: string
  persona: Persona
  sentiment: Sentiment
  action: DecisionActionTemplate
  confidence: number
  reasoning: string
  recommendation: string
  created_at?: string
  status?: string
  [key: string]: unknown
}

export interface PredictionApiResponse {
  agent1: Agent1Output
  agent2: Agent2Output
  agent3_output: Agent3Output
}

export interface DecisionRecord {
  user_id: string
  persona: Persona
  sentiment: Sentiment
  action?: DecisionActionTemplate
  action_type?: ActionType
  channel?: ActionChannel
  urgency?: ActionUrgency
  description?: string
  trigger_cond?: string
  confidence?: number
  reasoning?: string
  recommendation?: string
  id?: string
  decision_id?: string
  created_at?: string
  updated_at?: string
  status?: string
  converted?: boolean
  [key: string]: unknown
}

export interface DecisionDetails extends DecisionRecord {
  agent1?: Agent1Output
  agent2?: Agent2Output
  agent3_output?: Agent3Output
  user_meta?: JsonRecord
}