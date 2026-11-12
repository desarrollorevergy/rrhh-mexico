import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // En producción Express sirve el front y la API juntos; en local se redirige.
      '/api': 'http://localhost:3000',
    },
  },
})
