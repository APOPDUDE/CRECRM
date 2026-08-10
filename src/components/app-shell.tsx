import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@/components/error-boundary'
import {
  Building2,
  ChevronDown,
  Contact,
  Handshake,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Map,
  Menu,
  MoreHorizontal,
  Target,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useAuth } from '@/hooks/use-auth'
import { useBreadcrumbValue } from '@/hooks/use-breadcrumb'
import { cn } from '@/lib/utils'

// The daily drivers. Everything else lives behind "More" — they get opened rarely and
// were only ever crowding the rail.
const topItems = [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }]
const bottomItems = [{ to: '/properties', label: 'War Room', icon: Map }]

// The three books of business. Landlord and Tenant are deal boards; Buyers is a roster
// you search when a deal hits the market.
const pipelineItems = [
  { to: '/pipelines/landlord', label: 'Landlord', icon: Warehouse },
  { to: '/pipelines/tenant', label: 'Tenant', icon: Users },
  { to: '/pipelines/buyers', label: 'Buyers', icon: Wallet },
]

// Detail boards live outside /pipelines but belong to it as far as the rail is concerned.
const pipelinePrefixes = ['/pipelines', '/landlord-rep', '/tenant-rep']

const moreItems = [
  { to: '/prospecting', label: 'Prospecting', icon: Target },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/contacts', label: 'Contacts', icon: Contact },
  { to: '/companies', label: 'Companies', icon: Users },
]

const sectionLabels: Record<string, string> = {
  '': 'Dashboard',
  pipelines: 'Pipelines',
  prospecting: 'Prospecting',
  // Detail/match boards still live under these path prefixes — keep their breadcrumb labels.
  'landlord-rep': 'Landlord Rep',
  'tenant-rep': 'Tenant Rep',
  tasks: 'Tasks',
  contacts: 'Contacts',
  companies: 'Companies',
  // The route stays /properties; only the name changed.
  properties: 'War Room',
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white',
  )

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  // Open a drawer when you are already inside one of its pages, so the current
  // location is never hidden behind a collapsed section.
  const inMore = moreItems.some((i) => pathname.startsWith(i.to))
  const inPipelines = pipelinePrefixes.some((p) => pathname.startsWith(p))
  const [moreOpen, setMoreOpen] = useState(inMore)
  const [pipelinesOpen, setPipelinesOpen] = useState(inPipelines)

  return (
    <nav className="flex flex-col gap-1 px-2">
      {topItems.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={onNavigate} className={navLinkClass}>
          <item.icon className="size-4" />
          {item.label}
        </NavLink>
      ))}

      <button
        type="button"
        onClick={() => setPipelinesOpen((v) => !v)}
        aria-expanded={pipelinesOpen}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-white/10 hover:text-white',
          inPipelines ? 'text-white' : 'text-slate-300',
        )}
      >
        <Handshake className="size-4" />
        Pipelines
        <ChevronDown
          className={cn('ml-auto size-4 transition-transform', pipelinesOpen && 'rotate-180')}
        />
      </button>

      {pipelinesOpen && (
        <div className="ml-4 flex flex-col gap-1 border-l border-white/10 pl-2">
          {pipelineItems.map((item) => (
            <NavLink key={item.to} to={item.to} onClick={onNavigate} className={navLinkClass}>
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}

      {bottomItems.map((item) => (
        <NavLink key={item.to} to={item.to} onClick={onNavigate} className={navLinkClass}>
          <item.icon className="size-4" />
          {item.label}
        </NavLink>
      ))}

      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        aria-expanded={moreOpen}
        className="mt-1 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
      >
        <MoreHorizontal className="size-4" />
        More
        <ChevronDown className={cn('ml-auto size-4 transition-transform', moreOpen && 'rotate-180')} />
      </button>

      {moreOpen && (
        <div className="flex flex-col gap-1 border-l border-white/10 pl-2 ml-4">
          {moreItems.map((item) => (
            <NavLink key={item.to} to={item.to} onClick={onNavigate} className={navLinkClass}>
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  )
}

function SidebarBrand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link to="/" onClick={onNavigate} className="flex items-center gap-2 px-4 py-4">
      <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Building2 className="size-4" />
      </div>
      <span className="text-sm font-semibold text-white">CRE CRM</span>
    </Link>
  )
}

export function AppShell() {
  const { signOut } = useAuth()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const crumb = useBreadcrumbValue()

  const section = location.pathname.split('/')[1] ?? ''
  const sectionLabel = sectionLabels[section] ?? 'CRE CRM'
  const sectionPath = section ? `/${section}` : '/'

  return (
    <div className="flex min-h-svh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-svh w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-200 md:flex">
        <SidebarBrand />
        <Separator className="bg-slate-700/60" />
        <div className="flex-1 overflow-y-auto py-3">
          <NavLinks />
        </div>
        <Separator className="bg-slate-700/60" />
        <div className="p-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2.5 text-slate-300 hover:bg-white/10 hover:text-white"
            onClick={() => void signOut()}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar with breadcrumb */}
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background px-4">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="size-5" />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-slate-900 p-0 text-slate-200">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <SidebarBrand onNavigate={() => setMobileNavOpen(false)} />
              <Separator className="bg-slate-700/60" />
              <div className="py-3">
                <NavLinks onNavigate={() => setMobileNavOpen(false)} />
              </div>
              <Separator className="bg-slate-700/60" />
              <div className="p-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2.5 text-slate-300 hover:bg-white/10 hover:text-white"
                  onClick={() => void signOut()}
                >
                  <LogOut className="size-4" />
                  Sign out
                </Button>
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            {crumb ? (
              <>
                <Link to={sectionPath} className="text-muted-foreground hover:text-foreground">
                  {sectionLabel}
                </Link>
                <span className="text-muted-foreground">/</span>
                <span className="truncate">{crumb}</span>
              </>
            ) : (
              <span>{sectionLabel}</span>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
