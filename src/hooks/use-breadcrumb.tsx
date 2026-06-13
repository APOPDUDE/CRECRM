import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

interface BreadcrumbContextValue {
  crumb: string | null
  setCrumb: (crumb: string | null) => void
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | undefined>(undefined)

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumb, setCrumb] = useState<string | null>(null)
  return (
    <BreadcrumbContext.Provider value={{ crumb, setCrumb }}>{children}</BreadcrumbContext.Provider>
  )
}

export function useBreadcrumbValue() {
  const ctx = useContext(BreadcrumbContext)
  if (!ctx) throw new Error('useBreadcrumbValue must be used within BreadcrumbProvider')
  return ctx.crumb
}

/** Detail pages call this to append a trailing crumb (e.g. the entity name) to the top bar. */
export function useSetBreadcrumb(label: string | null | undefined) {
  const ctx = useContext(BreadcrumbContext)
  if (!ctx) throw new Error('useSetBreadcrumb must be used within BreadcrumbProvider')
  const { setCrumb } = ctx
  useEffect(() => {
    setCrumb(label ?? null)
    return () => setCrumb(null)
  }, [label, setCrumb])
}
