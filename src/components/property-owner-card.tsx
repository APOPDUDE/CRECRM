import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { useOwnerContacts, useOwnerProperties } from '@/hooks/use-owners'
import type { Property } from '@/hooks/use-properties'
import { formatPhone } from '@/lib/format'

/**
 * Who owns this building and whether we can actually reach them — the data-room answer,
 * right on the property page. Binary presentation on purpose (Alex): a contact is either
 * verified or it isn't; the confidence ladder stays in the DB.
 */
export function PropertyOwnerCard({ property }: { property: Property }) {
  const ownerId = property.owner_id
  const { data: contacts } = useOwnerContacts(ownerId)
  const { data: portfolio } = useOwnerProperties(ownerId)

  if (!ownerId && !property.owner_name) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Owner</h2>
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No owner on record — county enrichment hasn't matched this parcel yet.
        </div>
      </section>
    )
  }

  const verified = (contacts ?? []).filter((c) => c.confidence === 'confirmed')
  const others = (contacts ?? []).filter((c) => c.confidence !== 'confirmed')
  const portfolioCount = portfolio?.length ?? 0

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Owner</h2>
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{property.owner_name ?? 'Unknown owner'}</span>
          {verified.length > 0 ? (
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
              Verified owner
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">Not verified</Badge>
          )}
          {portfolioCount > 1 && (
            <span className="text-xs text-muted-foreground">
              {portfolioCount} properties in portfolio
            </span>
          )}
        </div>
        {property.owner_mailing_address && (
          <p className="text-xs text-muted-foreground">
            Mailing: {property.owner_mailing_address}
          </p>
        )}
        {(contacts ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No contacts yet — export this property for skip-tracing to start verification.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {/* once the owner is verified, the unverified skip-trace lines are noise */}
            {(verified.length > 0 ? verified : others).map((oc) => (
              <li key={oc.id} className="flex flex-wrap items-center gap-x-2 text-sm">
                <Link to={`/contacts/${oc.contact?.id}`} className="font-medium hover:underline">
                  {[oc.contact?.first_name, oc.contact?.last_name].filter(Boolean).join(' ') || 'Unknown'}
                </Link>
                {oc.contact?.phone && (
                  <a href={`tel:${oc.contact.phone}`} className="text-muted-foreground hover:underline">
                    {formatPhone(oc.contact.phone) ?? oc.contact.phone}
                  </a>
                )}
                {oc.contact?.email && (
                  <span className="text-xs text-muted-foreground">{oc.contact.email}</span>
                )}
                {oc.confidence === 'confirmed' ? (
                  <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 text-[10px]">
                    verified
                  </Badge>
                ) : (
                  <span className="text-[10px] text-muted-foreground">unverified</span>
                )}
                {oc.contact?.do_not_call && (
                  <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-[10px]">
                    DNC
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
