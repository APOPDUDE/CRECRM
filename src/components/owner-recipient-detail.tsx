import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConversationLog } from '@/components/conversation-log'
import { propertyKindLabels } from '@/components/property-form-dialog'
import type { OwnerRecipient } from '@/components/owner-outreach-dialog'
import { usePropertyConversations } from '@/hooks/use-communications'
import { useProperty } from '@/hooks/use-properties'
import { formatDate } from '@/lib/dates'
import { formatCurrency, formatPhone, formatSf } from '@/lib/format'

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-3 py-0.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{value}</span>
    </div>
  )
}

/**
 * The building and the conversation behind one recipient, so the decision to text them or
 * skip them can be made without leaving the blast. Deliberately in-dialog with prev/next
 * rather than a link out: opening the property page would lose the composed message and
 * every checkbox already set.
 */
export function OwnerRecipientDetail({
  recipient,
  index,
  total,
  included,
  canInclude,
  onToggleInclude,
  onBack,
  onPrev,
  onNext,
}: {
  recipient: OwnerRecipient
  index: number
  total: number
  included: boolean
  canInclude: boolean
  onToggleInclude: () => void
  onBack: () => void
  onPrev: () => void
  onNext: () => void
}) {
  const propertyQ = useProperty(recipient.recipientId)
  const commsQ = usePropertyConversations(recipient.recipientId, recipient.ownerId)
  const p = propertyQ.data
  const name = [recipient.first, recipient.last].filter(Boolean).join(' ') || recipient.company

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ChevronLeft className="size-4" />
          Back to list
        </Button>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">
            {index + 1} of {total}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7"
            onClick={onPrev}
            disabled={total < 2}
            aria-label="Previous owner"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7"
            onClick={onNext}
            disabled={total < 2}
            aria-label="Next owner"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-lg border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{name || 'Unknown owner'}</p>
            <p className="text-sm text-muted-foreground">
              {recipient.phone ? formatPhone(recipient.phone) : 'no number'}
              {recipient.company && name !== recipient.company && ` · ${recipient.company}`}
            </p>
          </div>
          <Link
            to={`/properties/${recipient.recipientId}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Open property <ExternalLink className="inline size-3" />
          </Link>
        </div>

        {/* The one decision this pane exists to serve. */}
        <label className="mt-3 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-sm">
          <Checkbox
            checked={included}
            disabled={!canInclude}
            onCheckedChange={onToggleInclude}
            aria-label="Include in this send"
          />
          <span className={canInclude ? '' : 'text-muted-foreground'}>
            {canInclude ? 'Include in this send' : 'No number — cannot be texted'}
          </span>
        </label>
      </div>

      <div className="rounded-lg border p-3">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Property</p>
        {propertyQ.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </p>
        ) : !p ? (
          <p className="text-sm text-muted-foreground">Could not load this property.</p>
        ) : (
          <>
            <p className="text-sm font-medium">{p.address}</p>
            <p className="mb-2 text-sm text-muted-foreground">
              {[p.city, p.state, p.zip].filter(Boolean).join(', ')}
              {p.county && ` · ${p.county} County`}
            </p>
            <div className="divide-y">
              <Fact
                label="Type"
                value={p.property_type ? propertyKindLabels[p.property_type] : null}
              />
              <Fact label="Gross SF" value={formatSf(p.gross_sf)} />
              <Fact label="Acres" value={p.land_acres != null ? String(p.land_acres) : null} />
              <Fact label="Year built" value={p.year_built != null ? String(p.year_built) : null} />
              <Fact label="Zoning" value={p.zoning_district ?? p.zoning_description} />
              <Fact label="Parcel" value={p.parcel_number} />
              <Fact
                label="Last sale"
                value={
                  p.last_sale_date
                    ? `${formatDate(p.last_sale_date)}${
                        p.last_sale_price ? ` · ${formatCurrency(p.last_sale_price)}` : ''
                      }`
                    : null
                }
              />
              <Fact
                label="Just value"
                value={p.just_value != null ? formatCurrency(p.just_value) : null}
              />
              <Fact label="Owner mailing" value={p.owner_mailing_address} />
            </div>
          </>
        )}
      </div>

      <div className="rounded-lg border p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">Conversation</p>
          {recipient.lastContactedAt ? (
            <Badge variant="secondary" className="font-normal">
              last {formatDate(recipient.lastContactedAt)}
            </Badge>
          ) : (
            <Badge variant="outline" className="font-normal">
              never contacted
            </Badge>
          )}
        </div>
        {commsQ.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <ConversationLog comms={commsQ.data ?? []} />
          </div>
        )}
      </div>
    </div>
  )
}
