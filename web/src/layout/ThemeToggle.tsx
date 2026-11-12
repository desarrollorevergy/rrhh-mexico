import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../theme/useTheme.ts'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const label = theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-accent-soft-strong focus-visible:outline-2 focus-visible:outline-accent"
    >
      {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  )
}
