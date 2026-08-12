import { Link } from 'react-router-dom'
import { Building2, Handshake } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useContactAssociations, type ContactDeal } from '@/hooks/use-contacts'
import { formatSf } from '@/lib/format'

/** Same status vocabulary the property page uses, so a stage reads the same everywhere. */
function StatusPill({ status }: { status: string | null }) {
  if (!status) return null
  const s = status.toLowerCase()
  const tone =
    s === 'lost' || s === 'passed'
      ? 'border-red-200 bg-red-50 text-red-700'
      : s === 'executed' || s === 'closed'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return (
    <Badge variant="outline" className={tone}>
      {status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ')}
    </Badge>
  )
}

const DEAL_KIND_LABEL: Record<ContactDeal['kind'], string> = {
  listing: 'Listing',
  client: 'Client',
  prospect: 'Prospect',
}

/**
 * What this contact is attached to — the properties they own or are the landlord contact
 * on, and every deal they appear in. Mirrors the association views on the property page so
 * a record is navigable from either end.
 *
 * Renders nothing when there is nothing to show: a contact with no deals should not carry
 * two empty headings down the page.
 */
export function ContactAssociations({ contactId }: { contactId: string }) {
  const { data, isLoading } = useContactAssociations(contactId)

  if (isLoading) {
    return (
      <section className="max-w-2xl space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-16 w-full" />
      </section>
    )
  }

  const properties = data?.properties ?? []
  const deals = data?.deals ?? []
  if (properties.length === 0 && deals.length === 0) return null

  return (
    <div className="max-w-2xl space-y-6">
      {properties.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Properties <span className="tabular-nums">({properties.length})</span>
          </h2>
          <div className="space-y-2">
            {properties.map((p) => {
              const size = formatSf(p.gross_sf) ?? (p.land_acres != null ? `${p.land_acres} AC` : null)
              const bits = [p.city, size].filter(Boolean).join(' · ')
              return (
                <Link
                  key={p.id}
                  to={`/properties/${p.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Building2 className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.address}</div>
                      {bits && <div className="truncate text-xs text-muted-foreground">{bits}</div>}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      p.via === 'owner'
                        ? 'shrink-0 border-blue-200 bg-blue-50 text-blue-700'
                        : 'shrink-0 text-muted-foreground'
                    }
                  >
                    {p.via === 'owner' ? 'Owner' : 'On listing'}
                  </Badge>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {deals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Deals <span className="tabular-nums">({deals.length})</span>
          </h2>
          <div className="space-y-2">
            {deals.map((d) => (
              <Link
                key={`${d.kind}-${d.id}`}
                to={d.href}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Handshake className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{d.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[DEAL_KIND_LABEL[d.kind], d.subtitle].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
                <StatusPill status={d.status} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
