import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { PropertyTypeBadge } from '@/pages/properties'
import { useProperty } from '@/hooks/use-properties'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'
import { formatDate } from '@/lib/dates'

interface PropertyPreviewProps {
  propertyId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

/** Quick property preview shown on the right when the card's preview icon is clicked. */
export function PropertyPreview({ propertyId, open, onOpenChange }: PropertyPreviewProps) {
  const navigate = useNavigate()
  const { data: p, isLoading } = useProperty(propertyId ?? undefined)
  const listingUrl = p?.listing_url

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        {isLoading || !p ? (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>Property</SheetTitle>
            </SheetHeader>
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          </>
        ) : (
          <>
            <SheetHeader className="border-b">
              <SheetTitle>{p.address}</SheetTitle>
              <SheetDescription>
                {[p.city, p.state, p.zip].filter(Boolean).join(', ') || 'Property'}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {p.property_type && <PropertyTypeBadge type={p.property_type} />}
                {p.source === 'scrape' && (
                  <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-600">
                    Scraped
                  </Badge>
                )}
              </div>

              {listingUrl && (
                <Button asChild variant="outline" className="w-full justify-between">
                  <a href={listingUrl} target="_blank" rel="noopener noreferrer">
                    View listing
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              )}

              {p.photo_urls && p.photo_urls.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {p.photo_urls.slice(0, 5).map((u, i) => {
                    const img = (
                      <img
                        src={u}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                        className="h-24 w-36 shrink-0 rounded-lg border object-cover"
                      />
                    )
                    return listingUrl ? (
                      <a
                        key={i}
                        href={listingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View listing"
                        className="shrink-0 transition-opacity hover:opacity-90"
                      >
                        {img}
                      </a>
                    ) : (
                      <span key={i} className="shrink-0">
                        {img}
                      </span>
                    )
                  })}
                </div>
              )}

              <div className="space-y-1.5 rounded-lg border p-3">
                <Row label="Asking rate" value={formatPsf(p.asking_rate_psf)} />
                <Row label="Asking price" value={formatCurrency(p.asking_price)} />
                <Row label="Building SF" value={formatSf(p.building_sf)} />
                <Row label="Land acres" value={p.land_acres != null ? `${p.land_acres} AC` : null} />
                <Row
                  label="Days on market"
                  value={p.days_on_market != null ? `${p.days_on_market} days` : null}
                />
                <Row label="Listed" value={p.listed_at ? formatDate(p.listed_at) : null} />
              </div>

              {(p.broker_name || p.broker_phone || p.broker_email) && (
                <div className="space-y-1 rounded-lg border p-3">
                  <p className="text-xs font-medium text-muted-foreground">Broker</p>
                  {p.broker_name && (
                    <div className="text-sm font-medium">
                      {p.broker_name}
                      {p.broker_company ? ` · ${p.broker_company}` : ''}
                    </div>
                  )}
                  {p.broker_phone && <div className="text-xs">{p.broker_phone}</div>}
                  {p.broker_email && <div className="text-xs">{p.broker_email}</div>}
                </div>
              )}

              {p.specs && <Row label="Specs" value={p.specs} />}

              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => {
                  onOpenChange(false)
                  navigate(`/properties/${p.id}`)
                }}
              >
                View full property
                <ArrowUpRight className="size-4" />
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
