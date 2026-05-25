import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './hooks/useThemeMode.jsx'
import DashboardLayout from './layouts/DashboardLayout.jsx'
import FeedbackPage from './pages/FeedbackPage.jsx'
import OverviewPage from './pages/OverviewPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="feedback" element={<FeedbackPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}