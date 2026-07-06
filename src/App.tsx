import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/app-shell'
import { ProtectedRoute } from '@/components/protected-route'
import { AuthProvider } from '@/hooks/use-auth'
import { BreadcrumbProvider } from '@/hooks/use-breadcrumb'
import { LoginPage } from '@/pages/login'
import { DashboardPage } from '@/pages/dashboard'
import { ReppingPage } from '@/pages/repping'
import { PropertyBoardPage } from '@/pages/property-board'
import { TenantBoardPage } from '@/pages/tenant-board'
import { TasksPage } from '@/pages/tasks'
import { CompaniesPage } from '@/pages/companies'
import { CompanyDetailPage } from '@/pages/company-detail'
import { ContactsPage } from '@/pages/contacts'
import { ContactDetailPage } from '@/pages/contact-detail'
import { PropertiesPage } from '@/pages/properties'
import { PropertyDetailPage } from '@/pages/property-detail'
import { ActivityPage } from '@/pages/activity'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 30s, so returning to the installed PWA (window focus)
      // doesn't refetch every query — notably the ~2,300-row properties list — on each
      // app-switch. Mutations still call invalidateQueries, which refetches immediately
      // regardless of staleTime, so edits stay live.
      staleTime: 30_000,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={200}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route
                element={
                  <BreadcrumbProvider>
                    <AppShell />
                  </BreadcrumbProvider>
                }
              >
                <Route path="/" element={<DashboardPage />} />
                <Route path="/activity" element={<ActivityPage />} />
                <Route path="/repping" element={<ReppingPage />} />
                <Route path="/landlord-rep" element={<Navigate to="/repping" replace />} />
                <Route path="/landlord-rep/:listingId" element={<PropertyBoardPage />} />
                <Route path="/tenant-rep" element={<Navigate to="/repping" replace />} />
                <Route path="/tenant-rep/:tenantRepId" element={<TenantBoardPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/contacts" element={<ContactsPage />} />
                <Route path="/contacts/:id" element={<ContactDetailPage />} />
                <Route path="/companies" element={<CompaniesPage />} />
                <Route path="/companies/:id" element={<CompanyDetailPage />} />
                <Route path="/properties" element={<PropertiesPage />} />
                <Route path="/properties/:id" element={<PropertyDetailPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" richColors />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
