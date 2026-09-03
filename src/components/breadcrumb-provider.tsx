import { useState } from 'react'
import type { ReactNode } from 'react'
import { BreadcrumbContext } from '@/hooks/use-breadcrumb'

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumb, setCrumb] = useState<string | null>(null)
  return (
    <BreadcrumbContext.Provider value={{ crumb, setCrumb }}>{children}</BreadcrumbContext.Provider>
  )
}
