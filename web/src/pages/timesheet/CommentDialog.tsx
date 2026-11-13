import { useState } from 'react'

interface Props {
  initialText: string
  /** Texto bajo el título, por ejemplo el día al que pertenece. */
  subtitle?: string
  readOnly?: boolean
  saving?: boolean
  onSave: (text: string) => void
  onClose: () => void
}

// Ventana para escribir, cambiar o quitar el comentario de una jornada.
export function CommentDialog({ initialText, subtitle, readOnly = false, saving = false, onSave, onClose }: Props) {
  const [text, setText] = useState(initialText)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 min-[520px]:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="comment-title"
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-xl"
      >
        <h2 id="comment-title" className="text-lg font-bold text-text">Comentario</h2>
        {subtitle && <p className="text-sm text-muted first-letter:uppercase">{subtitle}</p>}
        <textarea
          id="ts-comment"
          autoFocus
          rows={4}
          maxLength={1000}
          readOnly={readOnly}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Observaciones de la jornada"
          className="mt-2 w-full rounded-lg border border-border bg-surface p-3 text-[15px] text-text placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="h-10 cursor-pointer rounded-lg border border-border px-4 text-sm font-semibold text-text"
            onClick={onClose}
          >
            {readOnly ? 'Cerrar' : 'Cancelar'}
          </button>
          {!readOnly && (
            <button
              type="button"
              disabled={saving}
              className="h-10 cursor-pointer rounded-lg bg-brand-blue px-4 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() => onSave(text.trim())}
            >
              Guardar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
