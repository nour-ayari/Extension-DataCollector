import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './hooks/useThemeMode.jsx'
import { NotificationProvider } from './components/notifications'
import DashboardLayout from './layouts/DashboardLayout.jsx'
import Dashboard from './pages/Dashboard.tsx'
import FeedbackPage from './pages/FeedbackPage.tsx'
import OverviewPage from './pages/OverviewPage.tsx'
import SettingsPage from './pages/SettingsPage.jsx'

export default function App() {
  return (
    <ThemeProvider>
      <NotificationProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<DashboardLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="overview" element={<OverviewPage />} />
              <Route path="feedback" element={<FeedbackPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </NotificationProvider>
    </ThemeProvider>
  )
}