import { Link } from 'react-router-dom'
import logo from '../assets/revergy-logo.png'
import { ThemeToggle } from './ThemeToggle.tsx'

export function Header() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 min-[700px]:px-10">
      <Link
        to="/"
        title="Inicio"
        // El logo tiene el texto en gris oscuro: en modo oscuro va sobre una pastilla clara.
        className="flex h-11 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent in-data-[theme=dark]:bg-white in-data-[theme=dark]:px-2"
      >
        <img src={logo} alt="Revergy" className="h-11 w-[130px] object-contain" />
      </Link>

      <div className="flex min-w-0 items-center gap-3">
        <ThemeToggle />
      </div>
    </header>
  )
}
