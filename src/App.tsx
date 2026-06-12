import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { AppShell } from '@/components/app-shell'
import { ProtectedRoute } from '@/components/protected-route'
import { AuthProvider } from '@/hooks/use-auth'
import { LoginPage } from '@/pages/login'
import { PlaceholderPage } from '@/pages/placeholder'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route
                  path="/"
                  element={<PlaceholderPage title="Dashboard" description="Pipeline summaries land here in Phase 7." />}
                />
                <Route
                  path="/landlord-rep"
                  element={<PlaceholderPage title="Landlord Rep" description="The listings pipeline arrives in Phase 4." />}
                />
                <Route
                  path="/tenant-rep"
                  element={<PlaceholderPage title="Tenant Rep" description="The tenant pipeline arrives in Phase 4." />}
                />
                <Route
                  path="/contacts"
                  element={<PlaceholderPage title="Contacts" description="Contact management arrives in Phase 3." />}
                />
                <Route
                  path="/companies"
                  element={<PlaceholderPage title="Companies" description="Company management arrives in Phase 3." />}
                />
                <Route
                  path="/properties"
                  element={<PlaceholderPage title="Properties" description="Property management arrives in Phase 3." />}
                />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" richColors />
      </AuthProvider>
    </QueryClientProvider>
  )
}
