import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Prepara la base de datos local una sola vez, antes de todas las pruebas.
    globalSetup: ['./src/db/testSetup.ts'],
  },
})
