import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, MapPin, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PropertyFormDialog, propertyKindLabels } from '@/components/property-form-dialog'
import { PropertyMiniMap } from '@/components/property-mini-map'
import { MarketPositionCard } from '@/components/market-position-card'
import { InlineEditField } from '@/components/inline-edit-field'
import { FileSection } from '@/components/files/file-section'
import { PropertyTasks } from '@/components/property-tasks'
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
import { formatListingPrice } from '@/lib/format'
import { pursuitStageLabels } from '@/lib/stages'

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
  type FieldVal = string | number | boolean | null
  const saveField =
    (field: keyof TablesUpdate<'properties'>) => async (value: FieldVal) => {
      await updateProperty.mutateAsync({
        id: propertyId,
        [field]: value,
      } as TablesUpdate<'properties'> & { id: string })
    }
  const typeOptions = Object.entries(propertyKindLabels).map(([value, label]) => ({ value, label }))
  // Price / SF is derived from price ÷ building SF; editing it sets the price.
  const pricePerSf =
    property.asking_price != null && property.building_sf
      ? property.asking_price / property.building_sf
      : null
  const savePricePerSf = async (value: FieldVal) => {
    const n = value == null || value === '' ? null : Number(value)
    if (n == null) {
      await updateProperty.mutateAsync({ id: propertyId, asking_price: null })
      return
    }
    if (!property.building_sf) {
      toast.error('Add building SF first to set a price per SF')
      return
    }
    await updateProperty.mutateAsync({ id: propertyId, asking_price: Math.round(n * property.building_sf) })
  }
  const saveSubTypes = async (value: FieldVal) => {
    const arr = String(value ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    await updateProperty.mutateAsync({ id: propertyId, property_sub_types: arr.length ? arr : null })
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
              {property.listing_status === 'off_market' && (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 font-medium text-amber-700">
                  Off market
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

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <PropertyMiniMap
          lat={property.lat}
          lng={property.lng}
          address={property.address}
          city={property.city}
          state={property.state}
          zip={property.zip}
        />
        <MarketPositionCard propertyId={property.id} county={property.county} />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Pricing &amp; size</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <InlineEditField label="Asking price" value={property.asking_price} kind="currency" onSave={saveField('asking_price')} />
          <InlineEditField label="Price / SF" value={pricePerSf} kind="psf" onSave={savePricePerSf} note="auto" />
          <InlineEditField label="Base rate / SF/yr" value={property.asking_rate_psf} kind="psf" onSave={saveField('asking_rate_psf')} />
          <InlineEditField label="Opex / SF/yr" value={property.opex_psf} kind="psf" onSave={saveField('opex_psf')} />
          <InlineEditField label="All-in rent / mo" value={property.all_in_monthly_rent} kind="currency" note="auto" />
          <InlineEditField label="Cap rate" value={property.cap_rate_pct} kind="percent" onSave={saveField('cap_rate_pct')} />
          <InlineEditField label="Building SF" value={property.building_sf} kind="sf" onSave={saveField('building_sf')} />
          <InlineEditField label="Available SF (min)" value={property.space_sf_min} kind="sf" onSave={saveField('space_sf_min')} />
          <InlineEditField label="Available SF (max)" value={property.space_sf_max} kind="sf" onSave={saveField('space_sf_max')} />
          <InlineEditField label="Land acres" value={property.land_acres} kind="acres" onSave={saveField('land_acres')} />
          <InlineEditField label="Year built" value={property.year_built} kind="number" onSave={saveField('year_built')} />
          <InlineEditField label="Type" value={property.property_type} kind="select" options={typeOptions} onSave={saveField('property_type')} />
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Building &amp; location</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <InlineEditField label="Title" value={property.title} kind="text" onSave={saveField('title')} full />
          <InlineEditField label="Sub-types" value={property.property_sub_types?.join(', ') ?? null} kind="text" onSave={saveSubTypes} />
          <InlineEditField label="City" value={property.city} kind="text" onSave={saveField('city')} />
          <InlineEditField label="State" value={property.state} kind="text" onSave={saveField('state')} />
          <InlineEditField label="Zip" value={property.zip} kind="text" onSave={saveField('zip')} />
          <InlineEditField label="County" value={property.county} kind="text" note="auto" />
          <InlineEditField label="Building class" value={property.building_class} kind="text" onSave={saveField('building_class')} />
          <InlineEditField label="Construction status" value={property.construction_status} kind="text" onSave={saveField('construction_status')} />
          <InlineEditField label="Stories" value={property.stories} kind="number" onSave={saveField('stories')} />
          <InlineEditField label="Units" value={property.num_units} kind="number" onSave={saveField('num_units')} />
          <InlineEditField label="Year renovated" value={property.year_renovated} kind="number" onSave={saveField('year_renovated')} />
          <InlineEditField label="Gross leasable area" value={property.gross_leasable_area} kind="text" onSave={saveField('gross_leasable_area')} />
          <InlineEditField label="Building FAR" value={property.building_far} kind="text" onSave={saveField('building_far')} />
          <InlineEditField label="Parking ratio" value={property.parking_ratio} kind="text" onSave={saveField('parking_ratio')} />
          <InlineEditField label="Occupancy" value={property.occupancy} kind="text" onSave={saveField('occupancy')} />
          <InlineEditField label="Zoning district" value={property.zoning_district} kind="text" onSave={saveField('zoning_district')} />
          <InlineEditField label="Zoning description" value={property.zoning_description} kind="text" onSave={saveField('zoning_description')} full />
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Listing &amp; other</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <InlineEditField
            label="Listing status"
            value={property.listing_status}
            kind="select"
            options={[
              { value: 'on_market', label: 'On market' },
              { value: 'off_market', label: 'Off market' },
            ]}
            onSave={saveField('listing_status')}
          />
          <InlineEditField label="Broker name" value={property.broker_name} kind="text" onSave={saveField('broker_name')} />
          <InlineEditField label="Broker company" value={property.broker_company} kind="text" onSave={saveField('broker_company')} />
          <InlineEditField label="Broker phone" value={property.broker_phone} kind="text" onSave={saveField('broker_phone')} />
          <InlineEditField label="Broker email" value={property.broker_email} kind="text" onSave={saveField('broker_email')} />
          <InlineEditField label="Sale type" value={property.sale_type} kind="text" onSave={saveField('sale_type')} />
          <InlineEditField label="Sale conditions" value={property.sale_conditions} kind="text" onSave={saveField('sale_conditions')} />
          <InlineEditField label="On ground lease" value={property.on_ground_lease} kind="boolean" onSave={saveField('on_ground_lease')} />
          <InlineEditField label="Opportunity zone" value={property.opportunity_zone} kind="boolean" onSave={saveField('opportunity_zone')} />
          <InlineEditField label="Auction" value={property.is_auction} kind="boolean" onSave={saveField('is_auction')} />
          <InlineEditField label="Parcel number" value={property.parcel_number} kind="text" onSave={saveField('parcel_number')} />
          <InlineEditField label="Listed" value={property.listed_at} kind="date" onSave={saveField('listed_at')} />
          <InlineEditField label="Days on market" value={property.days_on_market} kind="number" note="auto" />
          <InlineEditField label="Listing URL" value={property.listing_url} kind="text" onSave={saveField('listing_url')} full />
          <InlineEditField label="Source" value={property.source} kind="text" note="auto" />
          <InlineEditField label="Specs" value={property.specs} kind="text" onSave={saveField('specs')} full />
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Files</h2>
        <FileSection parentType="property" parentId={property.id} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Tours &amp; tasks</h2>
        <PropertyTasks propertyId={property.id} />
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
