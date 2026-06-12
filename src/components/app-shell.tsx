import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Building,
  Building2,
  Contact,
  LayoutDashboard,
  LogOut,
  Menu,
  Store,
  Users,
  Warehouse,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/landlord-rep', label: 'Landlord Rep', icon: Warehouse },
  { to: '/tenant-rep', label: 'Tenant Rep', icon: Store },
  { to: '/contacts', label: 'Contacts', icon: Contact },
  { to: '/companies', label: 'Companies', icon: Users },
  { to: '/properties', label: 'Properties', icon: Building },
]

const routeLabels: Record<string, string> = {
  '/': 'Dashboard',
  '/landlord-rep': 'Landlord Rep',
  '/tenant-rep': 'Tenant Rep',
  '/contacts': 'Contacts',
  '/companies': 'Companies',
  '/properties': 'Properties',
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-2">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )
          }
        >
          <item.icon className="size-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

function SidebarBrand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link to="/" onClick={onNavigate} className="flex items-center gap-2 px-4 py-4">
      <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Building2 className="size-4" />
      </div>
      <span className="text-sm font-semibold">CRE CRM</span>
    </Link>
  )
}

export function AppShell() {
  const { signOut } = useAuth()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const currentLabel = routeLabels[location.pathname] ?? 'CRE CRM'

  return (
    <div className="flex min-h-svh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-svh w-56 shrink-0 flex-col border-r bg-sidebar md:flex">
        <SidebarBrand />
        <Separator />
        <div className="flex-1 overflow-y-auto py-3">
          <NavLinks />
        </div>
        <Separator />
        <div className="p-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2.5 text-muted-foreground"
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
            <SheetContent side="left" className="w-64 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <SidebarBrand onNavigate={() => setMobileNavOpen(false)} />
              <Separator />
              <div className="py-3">
                <NavLinks onNavigate={() => setMobileNavOpen(false)} />
              </div>
              <Separator />
              <div className="p-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2.5 text-muted-foreground"
                  onClick={() => void signOut()}
                >
                  <LogOut className="size-4" />
                  Sign out
                </Button>
              </div>
            </SheetContent>
          </Sheet>
          <div className="text-sm font-medium">{currentLabel}</div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
