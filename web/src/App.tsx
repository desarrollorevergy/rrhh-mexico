import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { AppShell } from './layout/AppShell.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'

// Página de prueba del motor de aprobaciones: solo existe en desarrollo.
const ApprovalsDemoPage = import.meta.env.DEV ? lazy(() => import('./pages/dev/ApprovalsDemoPage.tsx')) : null

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            {ApprovalsDemoPage && (
              <Route
                path="dev/aprobaciones"
                element={
                  <Suspense fallback={null}>
                    <ApprovalsDemoPage />
                  </Suspense>
                }
              />
            )}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
