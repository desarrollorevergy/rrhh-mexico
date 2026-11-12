import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { projectLabel, type Project } from './api.ts'

interface Props {
  id: string
  projects: Project[]
  value: number | null
  onChange: (projectId: number) => void
  disabled?: boolean
}

// Desplegable de analíticas con buscador (son muchas para una lista simple).
export function ProjectPicker({ id, projects, value, onChange, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const selected = projects.find((project) => project.id === value)

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return projects
    return projects.filter((project) => projectLabel(project).toLowerCase().includes(term))
  }, [projects, search])

  // Se cierra al pulsar fuera o con Escape.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setSearch('')
          setOpen((current) => !current)
        }}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-[15px] text-text disabled:cursor-default disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className={selected ? '' : 'text-faint'}>{selected ? projectLabel(selected) : 'Seleccionar…'}</span>
        <ChevronDown size={18} className="shrink-0 text-muted" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search size={16} className="shrink-0 text-muted" aria-hidden="true" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar código o proyecto"
              aria-label="Buscar analítica"
              className="h-11 w-full bg-transparent text-[15px] text-text outline-none placeholder:text-faint"
            />
          </div>
          <ul role="listbox" aria-label="Analíticas" className="max-h-64 overflow-y-auto py-1">
            {visible.map((project) => (
              <li key={project.id} role="option" aria-selected={project.id === value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(project.id)
                    setOpen(false)
                  }}
                  className={`w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent-soft-strong ${
                    project.id === value ? 'font-semibold text-accent' : 'text-text'
                  }`}
                >
                  {projectLabel(project)}
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="px-3 py-3 text-sm text-muted">Sin resultados</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
