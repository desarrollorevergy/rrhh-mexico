import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="px-4 py-10 min-[700px]:px-10">
      <h1 className="text-2xl font-bold text-text">Página no encontrada</h1>
      <Link to="/" className="mt-4 inline-block font-semibold text-accent hover:underline">
        Volver a los módulos
      </Link>
    </div>
  )
}
