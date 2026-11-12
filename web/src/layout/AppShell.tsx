import { Outlet } from 'react-router-dom'
import { Header } from './Header.tsx'

// Carcasa común: cabecera fija arriba y el contenido de cada pantalla debajo.
export function AppShell() {
  return (
    <div className="flex h-dvh flex-col bg-bg text-text">
      <Header />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
