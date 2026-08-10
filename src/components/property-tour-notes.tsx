import { Link } from 'react-router-dom'
import { Footprints } from 'lucide-react'
import { usePropertyNotes } from '@/hooks/use-notes'
import { contactNameOf } from '@/hooks/use-contacts'
import { formatDate } from '@/lib/dates'

/**
 * What tenants have said about this building, newest first.
 *
 * The point of filing tour feedback against the property rather than the deal: a year
 * from now the deal is dead and forgotten, but "three tenants walked this and all said
 * the yard was too tight" is exactly what you want before quoting it again. Each entry
 * names the deal that produced it, so the opinion keeps its provenance.
 */
export function PropertyTourNotes({ propertyId }: { propertyId: string }) {
  const { data: notes = [], isLoading } = usePropertyNotes(propertyId)

  if (isLoading) return null
  if (notes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tenant feedback yet. Marking a deal Interested or Passed on this building files
        the reason here.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {notes.map((n) => {
        const client = n.pursuit?.client
        const who =
          client?.company?.name ??
          (client?.contact ? contactNameOf(client.contact) : null)
        return (
          <li key={n.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm">{n.body}</p>
              {n.kind === 'tour' && (
                <Footprints
                  className="mt-0.5 size-3.5 shrink-0 text-amber-600"
                  aria-label="Tour feedback"
                />
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {formatDate(n.created_at)}
              {who && ' · '}
              {who &&
                (n.pursuit?.client_id ? (
                  // Straight back to the board this came off, so the opinion is checkable.
                  <Link
                    to={`/tenant-rep/${n.pursuit.client_id}`}
                    className="hover:text-primary hover:underline"
                  >
                    {who}
                  </Link>
                ) : (
                  who
                ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
