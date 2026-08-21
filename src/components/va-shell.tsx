import { Link, Outlet } from 'react-router-dom'
import { Building2, LogOut } from 'lucide-react'
import { ErrorBoundary } from '@/components/error-boundary'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'

/**
 * The shell a VA login sees: app name, "Texting", sign out — no sidebar, no breadcrumbs,
 * no routes into the rest of the CRM. Page-level navigation (Replies / Today's batch)
 * lives in TextingNav on the pages themselves, shared with Alex's view.
 */
export function VaShell() {
  const { signOut } = useAuth()

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2.5 border-b bg-background px-4">
        <Link to="/texting" className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2 className="size-4" />
          </div>
          <span className="text-sm font-semibold">CRE CRM</span>
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">Texting</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto gap-2 text-muted-foreground"
          onClick={() => void signOut()}
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 md:p-6">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
