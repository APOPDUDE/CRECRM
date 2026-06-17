import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, MapPin, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PropertyFormDialog, propertyKindLabels } from '@/components/property-form-dialog'
import { PropertyMiniMap } from '@/components/property-mini-map'
import { MarketPositionCard } from '@/components/market-position-card'
import { InlineEditField } from '@/components/inline-edit-field'
import { FileSection } from '@/components/files/file-section'
import { PropertyTypeBadge } from '@/pages/properties'
import { contactNameOf } from '@/hooks/use-contacts'
import {
  useProperty,
  useUpdateProperty,
  usePropertyDeals,
  type PropertyListing,
  type PropertyMatch,
} from '@/hooks/use-properties'
import type { TablesUpdate } from '@/lib/database.types'
import { usePropertyMarketPosition, isGoodDeal } from '@/hooks/use-market'
import { useSetBreadcrumb } from '@/hooks/use-breadcrumb'
import { formatListingPrice, formatSf } from '@/lib/format'
import { pursuitStageLabels } from '@/lib/stages'
import { formatDate } from '@/lib/dates'

/** A standard property field row — always rendered, shows an em-dash when empty. */
function Field({ label, value, full }: { label: string; value: ReactNode; full?: boolean }) {
  const empty = value == null || value === ''
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm ${empty ? 'text-muted-foreground' : ''}`}>
        {empty ? '—' : value}
      </dd>
    </div>
  )
}

const yesNo = (b: boolean | null): string | null => (b == null ? null : b ? 'Yes' : 'No')

const listingStageLabels: Record<string, string> = {
  proposal: 'Proposal',
  listed: 'Listed',
  closed: 'Closed',
}

function StatusPill({ status }: { status: 'active' | 'lost' | 'closed' | 'passed' | 'executed' }) {
  const map: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    executed: 'bg-blue-50 text-blue-700 border-blue-200',
    closed: 'bg-blue-50 text-blue-700 border-blue-200',
    lost: 'bg-red-50 text-red-700 border-red-200',
    passed: 'bg-red-50 text-red-700 border-red-200',
  }
  const label = status.charAt(0).toUpperCase() + status.slice(1)
  return (
    <Badge variant="outline" className={map[status]}>
      {label}
    </Badge>
  )
}

function ListingDealRow({ listing }: { listing: PropertyListing }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(`/landlord-rep/${listing.id}`)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {listing.landlord?.name ?? 'Landlord listing'}
        </div>
        <div className="text-xs text-muted-foreground">
          {listing.deal_type === 'sale'
            ? 'For sale'
            : listing.deal_type === 'both'
              ? 'For lease or sale'
              : 'For lease'}{' '}
          · {listingStageLabels[listing.stage] ?? listing.stage}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {formatListingPrice(listing) && (
          <span className="text-sm">{formatListingPrice(listing)}</span>
        )}
        <StatusPill status={listing.status === 'lost' ? 'lost' : listing.stage === 'closed' ? 'closed' : 'active'} />
      </div>
    </button>
  )
}

function MatchDealRow({ match }: { match: PropertyMatch }) {
  const navigate = useNavigate()
  const who =
    match.tenant_company?.name ??
    (match.tenant_contact ? contactNameOf(match.tenant_contact) : 'Tenant prospect')
  return (
    <button
      onClick={() => navigate(`/tenant-rep/${match.tenant_rep_id}`)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{who}</span>
          {match.flagged_new && (
            <Badge variant="outline" className="border-red-200 bg-red-50 font-medium text-red-700">
              New
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{pursuitStageLabels[match.stage]}</div>
      </div>
      <StatusPill status={match.stage === 'passed' ? 'passed' : match.stage === 'executed' ? 'executed' : 'active'} />
    </button>
  )
}

export function PropertyDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: property, isLoading, isError } = useProperty(id)
  const { data: deals } = usePropertyDeals(id)
  const { data: marketPos } = usePropertyMarketPosition(id)
  const updateProperty = useUpdateProperty()
  const [editOpen, setEditOpen] = useState(false)

  useSetBreadcrumb(property?.address)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full max-w-2xl" />
      </div>
    )
  }

  if (isError || !property) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/properties')}>
          <ArrowLeft className="size-4" />
          Back to properties
        </Button>
        <p className="text-sm text-muted-foreground">This property could not be found.</p>
      </div>
    )
  }

  const location = [property.city, property.state, property.zip].filter(Boolean).join(', ')
  const mapsQuery = encodeURIComponent(
    [property.address, property.city, property.state, property.zip].filter(Boolean).join(', '),
  )
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`
  const listingUrl = property.listing_url
  const sourceLabel =
    property.source === 'scrape' ? 'Scraped' : property.source === 'landlord_rep' ? 'My listing' : null
  const photos = property.photo_urls ?? []
  const listings = deals?.listings ?? []
  const matches = deals?.matches ?? []

  const propertyId = property.id
  const saveField =
    (field: keyof TablesUpdate<'properties'>) => async (value: number | null) => {
      await updateProperty.mutateAsync({ id: propertyId, [field]: value })
    }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back</span>
          </Button>
          <div>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in Google Maps"
              className="group inline-flex items-center gap-1.5 text-xl font-semibold hover:underline"
            >
              {property.address}
              <MapPin className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {property.property_type && <PropertyTypeBadge type={property.property_type} />}
              {sourceLabel && (
                <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-600">
                  {sourceLabel}
                </Badge>
              )}
              {isGoodDeal(marketPos) && (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700">
                  Good deal
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {listingUrl && (
            <Button variant="outline" asChild>
              <a href={listingUrl} target="_blank" rel="noopener noreferrer">
                View listing
                <ExternalLink className="size-4" />
              </a>
            </Button>
          )}
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
            Edit
          </Button>
        </div>
      </div>

      {photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {photos.slice(0, 6).map((url, i) => {
            const img = (
              <img
                src={url}
                alt=""
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
                className="h-28 w-40 shrink-0 rounded-lg border object-cover"
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

      <PropertyMiniMap
        lat={property.lat}
        lng={property.lng}
        address={property.address}
        city={property.city}
        state={property.state}
        zip={property.zip}
        className="max-w-2xl"
      />

      <MarketPositionCard propertyId={property.id} county={property.county} />

      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Field label="Title" value={property.title} full />
        <Field
          label="Type"
          value={property.property_type ? propertyKindLabels[property.property_type] : null}
        />
        <Field label="Sub-types" value={property.property_sub_types?.join(', ') ?? null} />
        <Field label="Location" value={location || null} />
        <Field label="County" value={property.county ? `${property.county} County` : null} />
        <Field label="Parcel number" value={property.parcel_number} />
        <InlineEditField
          label="Building SF"
          value={property.building_sf}
          kind="sf"
          onSave={saveField('building_sf')}
        />
        <Field
          label="Available space"
          value={
            property.space_sf_min != null || property.space_sf_max != null
              ? property.space_sf_min === property.space_sf_max
                ? formatSf(property.space_sf_min)
                : `${formatSf(property.space_sf_min) ?? '?'} – ${formatSf(property.space_sf_max) ?? '?'}`
              : null
          }
        />
        <InlineEditField
          label="Land acres"
          value={property.land_acres}
          kind="acres"
          onSave={saveField('land_acres')}
        />
        <Field label="Gross leasable area" value={property.gross_leasable_area} />
        <Field label="Stories" value={property.stories} />
        <Field label="Units" value={property.num_units} />
        <Field label="Year built" value={property.year_built} />
        <Field label="Year renovated" value={property.year_renovated} />
        <Field label="Building class" value={property.building_class} />
        <Field label="Construction status" value={property.construction_status} />
        <Field label="Building FAR" value={property.building_far} />
        <Field label="Parking ratio" value={property.parking_ratio} />
        <Field label="Occupancy" value={property.occupancy} />
        <Field label="Zoning district" value={property.zoning_district} />
        <Field label="Zoning description" value={property.zoning_description} full />
        <InlineEditField
          label="Asking rate"
          value={property.asking_rate_psf}
          kind="psf"
          onSave={saveField('asking_rate_psf')}
        />
        <InlineEditField
          label="Asking price"
          value={property.asking_price}
          kind="currency"
          onSave={saveField('asking_price')}
        />
        <InlineEditField
          label="Cap rate"
          value={property.cap_rate_pct}
          kind="percent"
          onSave={saveField('cap_rate_pct')}
        />
        <Field label="Sale type" value={property.sale_type} />
        <Field label="Sale conditions" value={property.sale_conditions} />
        <Field label="On ground lease" value={yesNo(property.on_ground_lease)} />
        <Field label="Opportunity zone" value={yesNo(property.opportunity_zone)} />
        <Field label="Auction" value={yesNo(property.is_auction)} />
        <Field
          label="Days on market"
          value={property.days_on_market != null ? `${property.days_on_market} days` : null}
        />
        <Field label="Listed" value={property.listed_at ? formatDate(property.listed_at) : null} />
        <Field
          label="Source last updated"
          value={property.source_last_updated ? formatDate(property.source_last_updated) : null}
        />
        <Field
          label="Broker"
          value={
            property.broker_name
              ? property.broker_company
                ? `${property.broker_name} · ${property.broker_company}`
                : property.broker_name
              : null
          }
        />
        <Field label="Broker phone" value={property.broker_phone} />
        <Field label="Broker email" value={property.broker_email} />
        <Field label="Source" value={property.source} />
        <Field label="Specs" value={property.specs} full />
      </dl>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Files</h2>
        <FileSection parentType="property" parentId={property.id} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Listings {listings.length > 0 && `(${listings.length})`}
          </h2>
          {listings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No landlord listings on this property.</p>
          ) : (
            <div className="space-y-2">
              {listings.map((l) => (
                <ListingDealRow key={l.id} listing={l} />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Tenant deals {matches.length > 0 && `(${matches.length})`}
          </h2>
          {matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tenant matches on this property yet.</p>
          ) : (
            <div className="space-y-2">
              {matches.map((m) => (
                <MatchDealRow key={m.id} match={m} />
              ))}
            </div>
          )}
        </section>
      </div>

      <PropertyFormDialog open={editOpen} onOpenChange={setEditOpen} property={property} />
    </div>
  )
}
