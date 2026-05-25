import { createContext, useContext, useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'dashboard-theme'

const ThemeContext = createContext(null)

function getInitialTheme() {
  if (typeof window === 'undefined') {
    return 'dark'
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (storedTheme === 'dark' || storedTheme === 'light') {
    return storedTheme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const value = {
    theme,
    setTheme,
    toggleTheme: () => setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark')),
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useThemeMode() {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useThemeMode must be used within ThemeProvider')
  }

  return context
}