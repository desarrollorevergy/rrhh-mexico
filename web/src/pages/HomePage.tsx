import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MODULES, type AppModule } from '../navigation/modules.ts'

const CARD_CLASS =
  'flex min-h-[134px] w-full cursor-pointer items-center gap-4 rounded-[14px] border border-border bg-surface py-3.5 pr-3 pl-5 text-left shadow-sm hover:bg-accent-soft active:bg-accent-soft-strong focus-visible:outline-2 focus-visible:outline-accent min-[700px]:min-h-[120px]'

function ModuleCardContent({ module }: { module: AppModule }) {
  const Icon = module.icon
  return (
    <>
      <span className="bg-brand-gradient flex size-[60px] shrink-0 items-center justify-center rounded-2xl text-white">
        <Icon size={30} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col self-stretch">
        <span className="truncate text-[17px] leading-7 font-bold text-text">{module.title}</span>
        <span className="flex-1 text-[13px] leading-[1.35] text-muted">{module.description}</span>
        <span
          className={`truncate pt-1 text-xs font-semibold ${module.available ? 'text-accent' : 'text-faint'}`}
        >
          Módulo {module.num}&nbsp;&nbsp;·&nbsp;&nbsp;{module.available ? 'Disponible' : 'Próximamente'}
        </span>
      </span>
    </>
  )
}

export function HomePage() {
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  return (
    <div className="px-2 py-6 min-[700px]:px-8">
      <div className="px-2">
        <p className="text-[13px] leading-6 font-bold text-accent">RECURSOS HUMANOS</p>
        <h1 className="mt-1 text-[27px] leading-tight font-bold text-text min-[700px]:text-[32px]">
          Módulos de la Plataforma
        </h1>
        <p className="mt-2 pb-3 text-[15px] text-muted">Selecciona el módulo al que quieres entrar.</p>
      </div>

      <ul
        aria-label="Módulos de la plataforma"
        className="grid grid-cols-1 gap-4 p-2 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-3"
      >
        {MODULES.map((module) => (
          <li key={module.num}>
            {module.available ? (
              <Link to={module.path} title={`Abrir módulo ${module.title}`} className={CARD_CLASS}>
                <ModuleCardContent module={module} />
              </Link>
            ) : (
              <button
                type="button"
                title={`Abrir módulo ${module.title}`}
                onClick={() => setNotice(`${module.title} estará disponible próximamente`)}
                className={CARD_CLASS}
              >
                <ModuleCardContent module={module} />
              </button>
            )}
          </li>
        ))}
      </ul>

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
        {notice && (
          <p className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text shadow-lg">
            {notice}
          </p>
        )}
      </div>
    </div>
  )
}
