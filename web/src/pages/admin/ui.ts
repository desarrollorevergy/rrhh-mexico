// Estilos compartidos de las pantallas de administración.

export const INPUT =
  'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent'

export const BUTTON_PRIMARY =
  'h-10 cursor-pointer rounded-lg bg-brand-blue px-4 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export const BUTTON_SECONDARY =
  'h-10 cursor-pointer rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-text hover:bg-accent-soft disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent'

export const LABEL = 'mb-1 block text-xs font-semibold text-secondary'

export const ERROR_BOX = 'rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800'

export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Ha ocurrido un error'
}
