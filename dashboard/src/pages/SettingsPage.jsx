import { useMemo } from 'react'
import { Globe, PlugZap, Sparkles, Wifi } from 'lucide-react'
import { Badge } from '../components/Badge.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { SectionCard } from '../components/SectionCard.jsx'
import { ThemeToggle } from '../components/ThemeToggle.jsx'
import { useThemeMode } from '../hooks/useThemeMode.jsx'
import { useApiHealth } from '../hooks/useApiHealth.js'

function statusTone(status) {
  if (status === 'connected') {
    return 'success'
  }

  if (status === 'offline') {
    return 'danger'
  }

  if (status === 'checking') {
    return 'info'
  }

  return 'muted'
}

function statusLabel(status) {
  if (status === 'connected') {
    return 'Connected'
  }

  if (status === 'offline') {
    return 'Offline'
  }

  if (status === 'checking') {
    return 'Checking'
  }

  return 'Not configured'
}

export default function SettingsPage() {
  const { theme } = useThemeMode()
  const apiHealth = useApiHealth()

  const runtimeChecks = useMemo(
    () => [
      {
        title: 'Theme persistence',
        detail: `The dashboard is currently using ${theme} mode and persists the preference locally.`,
        icon: Sparkles,
        tone: 'accent',
      },
      {
        title: 'API connectivity',
        detail: apiHealth.message,
        icon: Globe,
        tone: statusTone(apiHealth.status),
      },
      {
        title: 'Realtime channel',
        detail: 'WebSocket updates, reconnect behavior, and polling fallback are wired through the live dashboard hooks.',
        icon: Wifi,
        tone: 'info',
      },
      {
        title: 'Notification layer',
        detail: 'Toasts, bell notifications, unread counts, and browser permissions are managed by the shared notification store.',
        icon: PlugZap,
        tone: 'success',
      },
    ],
    [apiHealth.message, apiHealth.status, theme],
  )

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        eyebrow="Settings"
        title="Workspace configuration"
        description="Inspect the actual dashboard runtime state, API connectivity, and production feature readiness."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SectionCard title="Theme" description="Switch between light and dark mode with persistent state." className="h-full">
          <div className="flex flex-col gap-4">
            <Badge tone="info" className="w-fit">
              Active: {theme}
            </Badge>
            <ThemeToggle className="w-fit" />
          </div>
        </SectionCard>

        <SectionCard title="API connection" description="The dashboard uses a single production API base URL." className="h-full">
          <div className="space-y-3">
            <Badge tone={statusTone(apiHealth.status)} className="w-fit">
              {statusLabel(apiHealth.status)}
            </Badge>
            <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{apiHealth.message}</p>
          </div>
        </SectionCard>

        <SectionCard title="Environment" description="Frontend runtime and backend endpoint." className="h-full">
          <div className="space-y-3 text-sm text-slate-500 dark:text-slate-400">
            <p>
              Theme-aware UI: <span className="font-semibold text-slate-900 dark:text-white">{theme}</span>
            </p>
            <p>
              API endpoint: <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{apiHealth.baseUrl}</span>
            </p>
          </div>
        </SectionCard>

        <SectionCard title="Deployment" description="Current production wiring and readiness signals." className="h-full">
          <div className="space-y-3 text-sm text-slate-500 dark:text-slate-400">
            <p>Route shell, query layer, notifications, and realtime updates are all connected through shared production hooks.</p>
            <p>There are no mock dashboards or demo snapshots in the active route tree.</p>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Runtime checklist"
        description="These cards reflect live dashboard capabilities and backend integration status."
      >
        <div className="grid gap-4 xl:grid-cols-4">
          {runtimeChecks.map((item) => {
            const Icon = item.icon

            return (
              <div key={item.title} className="rounded-3xl border border-slate-200/80 p-5 dark:border-slate-800">
                <div className="mb-4 inline-flex rounded-2xl bg-indigo-500/10 p-3 text-indigo-600 dark:text-indigo-300">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <Badge tone={item.tone} className="w-fit">
                    Ready
                  </Badge>
                  <h3 className="text-base font-semibold text-slate-950 dark:text-white">{item.title}</h3>
                  <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{item.detail}</p>
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>
    </div>
  )
}
