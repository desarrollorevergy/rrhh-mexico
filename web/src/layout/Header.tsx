import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import logo from '../assets/revergy-logo.png'
import { ROLE_LABELS, useAuth } from '../auth/authContext.ts'
import { RoleSwitcher } from './RoleSwitcher.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

// El selector de usuario de prueba solo existe en desarrollo; en producción ni se descarga.
const DevUserSwitcher = import.meta.env.DEV ? lazy(() => import('../dev/DevUserSwitcher.tsx')) : null

export function Header() {
  const user = useAuth()
  const roles = user.roles.map((role) => ROLE_LABELS[role]).join(' · ')

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 min-[700px]:px-10">
      <Link
        to="/"
        title="Inicio"
        // El logo tiene el texto en gris oscuro: en modo oscuro va sobre una pastilla clara.
        className="flex h-11 shrink-0 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent in-data-[theme=dark]:bg-white in-data-[theme=dark]:px-2"
      >
        <img src={logo} alt="Revergy" className="h-11 w-[130px] object-contain" />
      </Link>

      <div className="flex min-w-0 items-center gap-3">
        <span title={roles} className="truncate text-[15px] font-semibold text-secondary">
          {user.name}
        </span>
        <RoleSwitcher />
        {DevUserSwitcher && (
          <Suspense fallback={null}>
            <DevUserSwitcher />
          </Suspense>
        )}
        <ThemeToggle />
      </div>
    </header>
  )
}
