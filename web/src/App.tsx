import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { AppShell } from './layout/AppShell.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'

// Las pantallas de cada módulo se descargan al entrar en ellas.
const AdminPage = lazy(() => import('./pages/admin/AdminPage.tsx'))
const TimesheetLayout = lazy(() => import('./pages/timesheet/TimesheetLayout.tsx'))
const TimesheetPage = lazy(() => import('./pages/timesheet/TimesheetPage.tsx'))
const WeekPage = lazy(() => import('./pages/timesheet/WeekPage.tsx'))

// Página de prueba del motor de aprobaciones: solo existe en desarrollo.
const ApprovalsDemoPage = import.meta.env.DEV ? lazy(() => import('./pages/dev/ApprovalsDemoPage.tsx')) : null

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route
              path="parte-horas"
              element={
                <Suspense fallback={null}>
                  <TimesheetLayout />
                </Suspense>
              }
            >
              <Route index element={<TimesheetPage />} />
              <Route path="semana" element={<WeekPage />} />
            </Route>
            <Route
              path="empleados"
              element={
                <Suspense fallback={null}>
                  <AdminPage />
                </Suspense>
              }
            />
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
