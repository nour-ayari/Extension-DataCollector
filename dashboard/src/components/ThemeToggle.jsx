import { MoonStar, SunMedium } from 'lucide-react'
import { useThemeMode } from '../hooks/useThemeMode.jsx'
import { cn } from '../utils/cn.js'

export function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useThemeMode()
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        'inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:border-slate-700',
        className,
      )}
    >
      {isDark ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
      <span className="hidden sm:inline">{isDark ? 'Light mode' : 'Dark mode'}</span>
      <span className="sm:hidden">Theme</span>
    </button>
  )
}