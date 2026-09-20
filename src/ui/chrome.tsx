import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'

const ThemeCtx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: 'dark',
  setTheme: () => {},
})

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  const fromDom = document.documentElement.dataset.theme
  if (fromDom === 'light' || fromDom === 'dark') return fromDom
  try {
    const saved = localStorage.getItem('muninn-theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* ignore */
  }
  return 'dark'
}

export function ThemeProvider(props: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('muninn-theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  return <ThemeCtx.Provider value={{ theme, setTheme }}>{props.children}</ThemeCtx.Provider>
}

function useTheme() {
  return useContext(ThemeCtx)
}

export function Brand(props: { small?: boolean; tagline?: string }) {
  return (
    <div className={`brand-lockup ${props.small ? 'sm' : ''}`}>
      <span className="brand-mark" aria-hidden />
      <span className="brand">
        <span className="brand-en">MUNINN</span>
        {props.tagline ? (
          <>
            <span className="brand-sep" aria-hidden>
              ·
            </span>
            <span className="brand-zh">{props.tagline}</span>
          </>
        ) : null}
      </span>
    </div>
  )
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="theme-toggle" role="group" aria-label="主题">
      <button type="button" className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>
        深色
      </button>
      <button type="button" className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>
        浅色
      </button>
    </div>
  )
}
