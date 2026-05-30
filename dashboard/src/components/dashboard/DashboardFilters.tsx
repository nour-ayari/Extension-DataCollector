import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Clock3, Filter, Search, Save, Trash2, X } from 'lucide-react'
import { Badge } from '../Badge.jsx'
import { SectionCard } from '../SectionCard'
import { cn } from '../../utils/cn.js'
import type { ActionType, ActionUrgency, DashboardDateRange, Persona, Sentiment, DecisionFilters } from '../../types/api'
import { formatActionType } from '../../utils/decision'

export interface DashboardFilterValues {
  urgencies: ActionUrgency[]
  personas: Persona[]
  sentiments: Sentiment[]
  actionTypes: ActionType[]
  dateRange: DashboardDateRange
  startDate: string
  endDate: string
  userId: string
}

export interface DashboardFiltersProps {
  value: DashboardFilterValues
  onApply: (value: DashboardFilterValues) => void
  onClearAll: () => void
  className?: string
}

export interface DashboardFilterPreset {
  id: string
  name: string
  value: DashboardFilterValues
  createdAt: string
}

const STORAGE_KEY = 'dashboard.filterPresets.v1'

export const DASHBOARD_FILTER_OPTIONS = {
  urgencies: ['critical', 'high', 'medium', 'low'] as ActionUrgency[],
  personas: ['Cold', 'Warm', 'High Intent', 'VIP', 'Hesitant'] as Persona[],
  sentiments: ['Positive', 'Neutral', 'Negative'] as Sentiment[],
  actionTypes: [
    'review_ask',
    'welcome_offer',
    'chatbot_fix',
    'price_nudge',
    'nurture_email',
    'apology_offer',
    'upsell',
    'scarcity_push',
    'exit_overlay',
    'referral',
    'early_access',
    'human_call',
    'chatbot_guide',
    'trust_signals',
    'survey',
  ] as ActionType[],
  dateRanges: [
    { value: 'today' as const, label: 'Today' },
    { value: '7d' as const, label: 'Last 7 days' },
    { value: '30d' as const, label: 'Last 30 days' },
    { value: 'custom' as const, label: 'Custom range' },
  ],
}

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilterValues = {
  urgencies: [],
  personas: [],
  sentiments: [],
  actionTypes: [],
  dateRange: '30d',
  startDate: '',
  endDate: '',
  userId: '',
}

function normalizeList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right))
}

function toQueryValue(values: string[]): string | undefined {
  return values.length > 0 ? values.join(',') : undefined
}

function parseList(value: string | null, allowedValues: readonly string[]): string[] {
  if (!value) {
    return []
  }

  const allowed = new Set(allowedValues)
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && allowed.has(entry))
}

function normalizeDate(value: string): string {
  if (!value) {
    return ''
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function toDateInputValue(value: string | null): string {
  return value ? normalizeDate(value) : ''
}

function cloneFilters(value: DashboardFilterValues): DashboardFilterValues {
  return {
    urgencies: [...value.urgencies],
    personas: [...value.personas],
    sentiments: [...value.sentiments],
    actionTypes: [...value.actionTypes],
    dateRange: value.dateRange,
    startDate: value.startDate,
    endDate: value.endDate,
    userId: value.userId,
  }
}

export function countActiveDashboardFilters(value: DashboardFilterValues): number {
  let count = 0

  count += value.urgencies.length
  count += value.personas.length
  count += value.sentiments.length
  count += value.actionTypes.length
  count += value.userId.trim().length > 0 ? 1 : 0
  count += value.dateRange === 'custom' && (value.startDate || value.endDate) ? 1 : value.dateRange === 'today' ? 0 : 1

  return count
}

export function dashboardFiltersToDecisionFilters(value: DashboardFilterValues): DecisionFilters {
  return {
    urgencies: value.urgencies,
    personas: value.personas,
    sentiments: value.sentiments,
    actionTypes: value.actionTypes,
    userId: value.userId.trim() || undefined,
    dateRange: value.dateRange,
    startDate: value.dateRange === 'custom' ? normalizeDate(value.startDate) || undefined : undefined,
    endDate: value.dateRange === 'custom' ? normalizeDate(value.endDate) || undefined : undefined,
  }
}

export function parseDashboardFilters(searchParams: URLSearchParams): DashboardFilterValues {
  const dateRange = (searchParams.get('dateRange') as DashboardDateRange | null) ?? DEFAULT_DASHBOARD_FILTERS.dateRange

  return {
    urgencies: parseList(searchParams.get('urgency'), DASHBOARD_FILTER_OPTIONS.urgencies),
    personas: parseList(searchParams.get('persona'), DASHBOARD_FILTER_OPTIONS.personas) as Persona[],
    sentiments: parseList(searchParams.get('sentiment'), DASHBOARD_FILTER_OPTIONS.sentiments) as Sentiment[],
    actionTypes: parseList(searchParams.get('actionType'), DASHBOARD_FILTER_OPTIONS.actionTypes) as ActionType[],
    dateRange: ['today', '7d', '30d', 'custom'].includes(dateRange) ? dateRange : '30d',
    startDate: toDateInputValue(searchParams.get('startDate')),
    endDate: toDateInputValue(searchParams.get('endDate')),
    userId: searchParams.get('userId')?.trim() ?? '',
  }
}

export function serializeDashboardFilters(value: DashboardFilterValues): URLSearchParams {
  const params = new URLSearchParams()

  const urgency = toQueryValue(normalizeList(value.urgencies))
  const persona = toQueryValue(normalizeList(value.personas))
  const sentiment = toQueryValue(normalizeList(value.sentiments))
  const actionType = toQueryValue(normalizeList(value.actionTypes))

  if (urgency) params.set('urgency', urgency)
  if (persona) params.set('persona', persona)
  if (sentiment) params.set('sentiment', sentiment)
  if (actionType) params.set('actionType', actionType)
  if (value.dateRange !== DEFAULT_DASHBOARD_FILTERS.dateRange) params.set('dateRange', value.dateRange)
  if (value.dateRange === 'custom' && value.startDate) params.set('startDate', normalizeDate(value.startDate))
  if (value.dateRange === 'custom' && value.endDate) params.set('endDate', normalizeDate(value.endDate))
  if (value.userId.trim()) params.set('userId', value.userId.trim())

  return params
}

function readPresets(): DashboardFilterPreset[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as DashboardFilterPreset[]
    return Array.isArray(parsed)
      ? parsed
          .filter((preset) => typeof preset?.id === 'string' && typeof preset?.name === 'string' && typeof preset?.value === 'object')
          .map((preset) => ({
            ...preset,
            value: { ...DEFAULT_DASHBOARD_FILTERS, ...preset.value },
          }))
      : []
  } catch {
    return []
  }
}

function writePresets(presets: DashboardFilterPreset[]): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}

function chipTone(index: number): string {
  const tones = [
    'bg-indigo-500/10 text-indigo-700 ring-1 ring-inset ring-indigo-500/20 dark:text-indigo-300',
    'bg-cyan-500/10 text-cyan-700 ring-1 ring-inset ring-cyan-500/20 dark:text-cyan-300',
    'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300',
    'bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300',
  ]

  return tones[index % tones.length]
}

export function DashboardFilters({ value, onApply, onClearAll, className = '' }: DashboardFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [draft, setDraft] = useState<DashboardFilterValues>(() => cloneFilters(value))
  const [userIdInput, setUserIdInput] = useState(value.userId)
  const [presetName, setPresetName] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [presets, setPresets] = useState<DashboardFilterPreset[]>([])
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null)
  const firstControlRef = useRef<HTMLSelectElement | HTMLButtonElement | HTMLInputElement | null>(null)
  const previousExpandedRef = useRef(isExpanded)

  useEffect(() => {
    setDraft(cloneFilters(value))
    setUserIdInput(value.userId)
  }, [value])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDraft((current) => ({ ...current, userId: userIdInput.trim() }))
    }, 300)

    return () => window.clearTimeout(handle)
  }, [userIdInput])

  useEffect(() => {
    setPresets(readPresets())
  }, [])

  useEffect(() => {
    const wasExpanded = previousExpandedRef.current
    previousExpandedRef.current = isExpanded

    if (!wasExpanded && isExpanded) {
      window.requestAnimationFrame(() => {
        firstControlRef.current?.focus()
      })
    }

    if (wasExpanded && !isExpanded) {
      toggleButtonRef.current?.focus()
    }
  }, [isExpanded])

  const activeCount = useMemo(() => countActiveDashboardFilters(value), [value])

  const activeChips = useMemo(() => {
    const chips: Array<{ label: string; onRemove?: () => void }> = []

    value.urgencies.forEach((urgency, index) => chips.push({ label: `Urgency: ${urgency}`, onRemove: () => setDraft((current) => ({ ...current, urgencies: current.urgencies.filter((item) => item !== urgency) })) && undefined }))
    value.personas.forEach((persona) => chips.push({ label: `Persona: ${persona}`, onRemove: () => setDraft((current) => ({ ...current, personas: current.personas.filter((item) => item !== persona) })) && undefined }))
    value.sentiments.forEach((sentiment) => chips.push({ label: `Sentiment: ${sentiment}`, onRemove: () => setDraft((current) => ({ ...current, sentiments: current.sentiments.filter((item) => item !== sentiment) })) && undefined }))
    value.actionTypes.forEach((actionType) => chips.push({ label: `Action: ${formatActionType(actionType)}`, onRemove: () => setDraft((current) => ({ ...current, actionTypes: current.actionTypes.filter((item) => item !== actionType) })) && undefined }))

    if (value.dateRange === 'custom') {
      chips.push({ label: `Date: ${value.startDate || 'Start'} → ${value.endDate || 'End'}` })
    } else if (value.dateRange !== 'today') {
      const label = DASHBOARD_FILTER_OPTIONS.dateRanges.find((option) => option.value === value.dateRange)?.label ?? value.dateRange
      chips.push({ label: `Date: ${label}` })
    }

    if (value.userId.trim()) {
      chips.push({ label: `User: ${value.userId.trim()}` })
    }

    return chips
  }, [value])

  function applyChange(next: Partial<DashboardFilterValues>): void {
    setDraft((current) => ({ ...current, ...next }))
  }

  function toggleSelection<T extends string>(key: keyof DashboardFilterValues, item: T): void {
    setDraft((current) => {
      const values = [...(current[key] as T[])]
      const nextValues = values.includes(item) ? values.filter((entry) => entry !== item) : [...values, item]
      return { ...current, [key]: nextValues } as DashboardFilterValues
    })
  }

  function handleLoadPreset(): void {
    const preset = presets.find((entry) => entry.id === selectedPresetId)
    if (!preset) {
      return
    }

    setDraft(cloneFilters(preset.value))
    setUserIdInput(preset.value.userId)
    setIsExpanded(true)
  }

  function handleSavePreset(): void {
    const trimmedName = presetName.trim()
    if (!trimmedName) {
      return
    }

    const nextPreset: DashboardFilterPreset = {
      id: `${Date.now()}`,
      name: trimmedName,
      value: cloneFilters(draft),
      createdAt: new Date().toISOString(),
    }

    const nextPresets = [...presets.filter((preset) => preset.name !== trimmedName), nextPreset]
    setPresets(nextPresets)
    writePresets(nextPresets)
    setPresetName('')
    setSelectedPresetId(nextPreset.id)
  }

  function handleDeletePreset(): void {
    if (!selectedPresetId) {
      return
    }

    const nextPresets = presets.filter((preset) => preset.id !== selectedPresetId)
    setPresets(nextPresets)
    writePresets(nextPresets)
    setSelectedPresetId('')
  }

  function handleApply(): void {
    onApply(cloneFilters(draft))
  }

  function handleClear(): void {
    setDraft(cloneFilters(DEFAULT_DASHBOARD_FILTERS))
    setUserIdInput('')
    setSelectedPresetId('')
    onClearAll()
  }

  return (
    <SectionCard
      title="Dashboard Filters"
      description="Compact filter bar with multi-selects, search, presets, and shareable URL state."
      className={cn('overflow-hidden', className)}
      actions={(
        <div className="flex items-center gap-2">
          <Badge tone={activeCount > 0 ? 'accent' : 'neutral'} className="gap-2">
            <Filter className="h-3.5 w-3.5" />
            {activeCount} active
          </Badge>
          <button
            ref={toggleButtonRef}
            type="button"
            aria-expanded={isExpanded}
            aria-controls="dashboard-filters-panel"
            onClick={() => setIsExpanded((current) => !current)}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {presets.length > 0 ? (
            <>
              <label className="sr-only" htmlFor="dashboard-preset-select">
                Saved preset
              </label>
              <select
                id="dashboard-preset-select"
                value={selectedPresetId}
                onChange={(event) => setSelectedPresetId(event.target.value)}
                className="h-10 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300"
              >
                <option value="">Saved presets</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleLoadPreset}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white"
              >
                Load
              </button>
              <button
                type="button"
                onClick={handleDeletePreset}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3.5 text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </>
          ) : null}

          <label className="sr-only" htmlFor="dashboard-preset-name">
            Preset name
          </label>
          <input
            id="dashboard-preset-name"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Name this preset"
            className="h-10 min-w-52 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300"
          />
          <button
            type="button"
            onClick={handleSavePreset}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-3.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            <Save className="h-4 w-4" />
            Save preset
          </button>
        </div>

        {isExpanded ? (
          <div id="dashboard-filters-panel" className="space-y-4 rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Urgency</div>
                <div className="flex flex-wrap gap-2">
                  {DASHBOARD_FILTER_OPTIONS.urgencies.map((option, index) => {
                    const selected = draft.urgencies.includes(option)
                    return (
                      <button
                        key={option}
                        ref={index === 0 ? firstControlRef : undefined}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleSelection('urgencies', option)}
                        className={cn('rounded-full px-3 py-2 text-sm font-medium transition', selected ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'border border-slate-200 bg-white/80 text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300')}
                      >
                        {option.charAt(0).toUpperCase() + option.slice(1)}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Sentiment</div>
                <div className="flex flex-wrap gap-2">
                  {DASHBOARD_FILTER_OPTIONS.sentiments.map((option) => {
                    const selected = draft.sentiments.includes(option)
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleSelection('sentiments', option)}
                        className={cn('rounded-full px-3 py-2 text-sm font-medium transition', selected ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white/80 text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300')}
                      >
                        {option}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">User ID search</div>
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={firstControlRef}
                    value={userIdInput}
                    onChange={(event) => setUserIdInput(event.target.value)}
                    placeholder="Search by user ID"
                    aria-label="Search by user ID"
                    className="h-11 w-full rounded-full border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300"
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Persona</div>
                <label className="block">
                  <select
                    multiple
                    value={draft.personas}
                    onChange={(event) => {
                      const next = Array.from(event.target.selectedOptions).map((option) => option.value as Persona)
                      applyChange({ personas: next })
                    }}
                    aria-label="Persona multi-select"
                    className="min-h-32 w-full rounded-[20px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300"
                  >
                    {DASHBOARD_FILTER_OPTIONS.personas.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Action type</div>
                <label className="block">
                  <select
                    multiple
                    value={draft.actionTypes}
                    onChange={(event) => {
                      const next = Array.from(event.target.selectedOptions).map((option) => option.value as ActionType)
                      applyChange({ actionTypes: next })
                    }}
                    aria-label="Action type multi-select"
                    className="min-h-32 w-full rounded-[20px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300"
                  >
                    {DASHBOARD_FILTER_OPTIONS.actionTypes.map((option) => (
                      <option key={option} value={option}>
                        {formatActionType(option)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Date range</div>
                <div className="flex flex-wrap gap-2">
                  {DASHBOARD_FILTER_OPTIONS.dateRanges.map((option) => {
                    const selected = draft.dateRange === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => applyChange({ dateRange: option.value })}
                        className={cn('rounded-full px-3 py-2 text-sm font-medium transition', selected ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'border border-slate-200 bg-white/80 text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300')}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Custom dates</div>
                <div className="flex flex-wrap gap-3">
                  <label className="flex-1 min-w-40">
                    <span className="sr-only">Start date</span>
                    <input
                      type="date"
                      value={draft.startDate}
                      onChange={(event) => applyChange({ dateRange: 'custom', startDate: event.target.value })}
                      aria-label="Start date"
                      className="h-11 w-full rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300"
                    />
                  </label>
                  <label className="flex-1 min-w-40">
                    <span className="sr-only">End date</span>
                    <input
                      type="date"
                      value={draft.endDate}
                      onChange={(event) => applyChange({ dateRange: 'custom', endDate: event.target.value })}
                      aria-label="End date"
                      className="h-11 w-full rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-[20px] border border-slate-200/80 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              {activeChips.map((chip, index) => (
                <Badge key={`${chip.label}-${index}`} tone="info" className={cn('gap-2', chipTone(index))}>
                  <button
                    type="button"
                    aria-label={`Remove ${chip.label}`}
                    onClick={() => {
                      if (chip.label.startsWith('Urgency: ')) {
                        const value = chip.label.replace('Urgency: ', '') as ActionUrgency
                        applyChange({ urgencies: draft.urgencies.filter((item) => item !== value) })
                      } else if (chip.label.startsWith('Persona: ')) {
                        const value = chip.label.replace('Persona: ', '') as Persona
                        applyChange({ personas: draft.personas.filter((item) => item !== value) })
                      } else if (chip.label.startsWith('Sentiment: ')) {
                        const value = chip.label.replace('Sentiment: ', '') as Sentiment
                        applyChange({ sentiments: draft.sentiments.filter((item) => item !== value) })
                      } else if (chip.label.startsWith('Action: ')) {
                        const label = chip.label.replace('Action: ', '')
                        applyChange({ actionTypes: draft.actionTypes.filter((item) => formatActionType(item) !== label) })
                      } else if (chip.label.startsWith('User: ')) {
                        applyChange({ userId: '' })
                        setUserIdInput('')
                      } else if (chip.label.startsWith('Date: ')) {
                        applyChange({ dateRange: 'today', startDate: '', endDate: '' })
                      }
                    }}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/60 text-[10px] font-bold text-slate-600 transition hover:bg-white dark:bg-slate-950/60 dark:text-slate-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  {chip.label}
                </Badge>
              ))}
              {activeChips.length === 0 ? <span className="text-sm text-slate-500 dark:text-slate-400">No active filters yet.</span> : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Clock3 className="h-4 w-4" />
                Press Apply Filters to update the dashboard and URL.
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleClear}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white"
                >
                  Clear All
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div id="dashboard-filters-panel" className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500 transition dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
            Filters are collapsed. Your current active filters remain applied to the dashboard.
          </div>
        )}
      </div>
    </SectionCard>
  )
}

export default DashboardFilters
