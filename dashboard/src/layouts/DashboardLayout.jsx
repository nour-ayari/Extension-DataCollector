import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar.jsx'
import { Topbar } from '../components/Topbar.jsx'
import { routeMeta } from '../data/dashboardData.js'
import { useApiHealth } from '../hooks/useApiHealth.js'

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const apiHealth = useApiHealth()

  const currentMeta = routeMeta[location.pathname] || routeMeta['/']

  return (
    <div className="min-h-screen text-slate-900 dark:text-slate-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} apiHealth={apiHealth} />

      <div className="lg:pl-72">
        <Topbar
          title={currentMeta.title}
          subtitle={currentMeta.subtitle}
          onMenuClick={() => setSidebarOpen(true)}
          apiHealth={apiHealth}
        />

        <main className="px-4 py-8 sm:px-6 lg:py-10 xl:px-10">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}