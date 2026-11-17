import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Publica /sw.js a partir de sw.template.js con la lista de todos los archivos compilados,
 * para que la app se pueda abrir sin red (incluidas las pantallas que se cargan bajo demanda).
 * La versión cambia con cada compilación distinta, y eso hace que el navegador lo actualice.
 */
function serviceWorker(): Plugin {
  return {
    name: 'rrhh-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const compiled = Object.keys(bundle).filter((file) => file !== 'index.html' && !file.endsWith('.map'))
      const publicFiles = readdirSync(new URL('./public', import.meta.url), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `${entry.parentPath}/${entry.name}`.replaceAll('\\', '/').split('/public/').pop() ?? '')
      const files = ['/', ...[...compiled, ...publicFiles].filter(Boolean).map((file) => `/${file}`)].sort()
      const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 12)
      const source = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(files))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  server: {
    proxy: {
      // En producción Express sirve el front y la API juntos; en local se redirige.
      '/api': 'http://localhost:3000',
    },
  },
})
