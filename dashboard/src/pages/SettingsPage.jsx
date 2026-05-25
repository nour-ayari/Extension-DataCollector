import { useThemeMode } from '../hooks/useThemeMode.jsx'
import { useApiHealth } from '../hooks/useApiHealth.js'
import { Badge } from '../components/Badge.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { SectionCard } from '../components/SectionCard.jsx'
import { useDashboardSnapshot } from '../hooks/useDashboardSnapshot.js'
import { ThemeToggle } from '../components/ThemeToggle.jsx'

export default function SettingsPage() {
  const { theme } = useThemeMode()
  const apiHealth = useApiHealth()
  const { integrationChecklist } = useDashboardSnapshot()

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        eyebrow="Settings"
        title="Workspace configuration"
        description="Keep the dashboard ready for API integration, theming, and larger product workflows."
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

        <SectionCard title="API client" description="Axios is configured and ready for the backend." className="h-full">
          <div className="space-y-3">
            <Badge tone={apiHealth.status === 'connected' ? 'success' : apiHealth.status === 'offline' ? 'danger' : 'info'} className="w-fit">
              {apiHealth.status === 'connected'
                ? 'Connected'
                : apiHealth.status === 'offline'
                  ? 'Offline'
                  : apiHealth.status === 'checking'
                    ? 'Checking'
                    : 'Mock mode'}
            </Badge>
            <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{apiHealth.message}</p>
          </div>
        </SectionCard>

        <SectionCard title="Environment" description="Frontend runtime and API base URL." className="h-full">
          <div className="space-y-3 text-sm text-slate-500 dark:text-slate-400">
            <p>
              Theme-aware UI: <span className="font-semibold text-slate-900 dark:text-white">{theme}</span>
            </p>
            <p>
              API endpoint: <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{apiHealth.baseUrl}</span>
            </p>
          </div>
        </SectionCard>

        <SectionCard title="Routing" description="React Router splits the dashboard into modular sections." className="h-full">
          <div className="space-y-3 text-sm text-slate-500 dark:text-slate-400">
            <p>Overview, feedback, and settings are isolated as route-level pages.</p>
            <p>The layout and navigation stay shared across the entire dashboard shell.</p>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Architecture checklist"
        description="The current UI architecture is ready for real API endpoints and richer dashboard states."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          {integrationChecklist.map((item) => {
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