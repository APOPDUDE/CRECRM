import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Pencil, Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PropertyFormDialog, propertyKindLabels } from '@/components/property-form-dialog'
import { PropertyMiniMap } from '@/components/property-mini-map'
import { AddressActions } from '@/components/address-actions'
import { ValueEstimateCard } from '@/components/value-estimate-card'
import { PropertyOwnerCard } from '@/components/property-owner-card'
import { PropertyTags } from '@/components/property-tags'
import { PropertySynopsis } from '@/components/property-synopsis'
import { AddToClientDialog } from '@/components/add-to-client-dialog'
import { InlineEditField } from '@/components/inline-edit-field'
import { FileSection } from '@/components/files/file-section'
import { PropertyTasks } from '@/components/property-tasks'
import { PropertyComps } from '@/components/property-comps'
import { PropertyTourNotes } from '@/components/property-tour-notes'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { EnrichParcelDialog } from '@/components/enrich-parcel-dialog'
import { PropertyTypeBadge } from '@/pages/properties'
import { contactNameOf } from '@/hooks/use-contacts'
import {
  useProperty,
  useUpdateProperty,
  usePropertyDeals,
  useEnrichProperty,
  useDeleteProperty,
  type PropertyListing,
  type PropertyMatch,
} from '@/hooks/use-properties'
import type { TablesUpdate } from '@/lib/database.types'
import { useCurrentListingEvent } from '@/hooks/use-comps'
import { friendlyDbError } from '@/lib/db-errors'
import { usePropertyMarketPosition, isGoodDeal } from '@/hooks/use-market'
import { useSetBreadcrumb } from '@/hooks/use-breadcrumb'
import { useBackTo } from '@/hooks/use-back-to'
import { formatCurrency, formatListingPrice } from '@/lib/format'
import { dorLabel } from '@/lib/dor-codes'
import { ENRICHABLE_COUNTIES } from '@/lib/parcel'
import { pursuitStageLabels } from '@/lib/stages'

function AppraiserField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || '—'}</dd>
    </div>
  )
}

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
  const { data: listingEvent } = useCurrentListingEvent(id)
  const enrich = useEnrichProperty()
  const updateProperty = useUpdateProperty()
  const deleteProperty = useDeleteProperty()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [enrichAskOpen, setEnrichAskOpen] = useState(false)
  const [addToDealOpen, setAddToDealOpen] = useState(false)

  const goBack = useBackTo('/properties')

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
        <Button variant="ghost" size="sm" onClick={goBack}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <p className="text-sm text-muted-foreground">This property could not be found.</p>
      </div>
    )
  }

  const fullAddress = [property.address, property.city, property.state, property.zip]
    .filter(Boolean)
    .join(', ')
  // R7: the listing event lives on the latest asking comp — the matching
  // properties.* columns are dropped. The "Listing & other" grid shows the
  // event fields read-only from the comp; edits belong on the comp itself
  // (CompEditDialog in the comps section).
  const listingUrl = listingEvent?.listing_url
  const sourceLabel =
    property.source === 'scrape' ? 'Scraped' : property.source === 'landlord_rep' ? 'My listing' : null
  const photos = property.photo_urls ?? []
  const appraiser = (property.appraiser_data ?? null) as
    | { status?: string; tried?: { field?: string; value?: string } }
    | null
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
  const saveSubTypes = async (value: FieldVal) => {
    const arr = String(value ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    await updateProperty.mutateAsync({ id: propertyId, property_sub_types: arr.length ? arr : null })
  }

  return (
    <div className="space-y-6">
      {/* Sticks just under the app's own h-14 top bar, so the address and the listing
          link stay reachable while scrolling a long spec sheet. Negative margins let the
          bar span the full width of <main>'s padding. */}
      <div className="sticky top-14 z-20 -mx-4 -mt-4 border-b bg-background px-4 pb-3 pt-4 md:-mx-6 md:-mt-6 md:px-6 md:pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={goBack}
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back</span>
          </Button>
          <div className="group/header">
            {/* Full address lives here now — city/state/zip were dropped from the
                details grid below, since repeating them there was pure noise.
                No longer a Google Maps link: the buttons beside it cover Apple Maps,
                Google Earth and copy, and the mini-map tile goes to our Deal Map. */}
            <span className="inline-flex flex-wrap items-center gap-2 text-2xl font-semibold">
              {fullAddress}
              <AddressActions address={fullAddress} lat={property.lat} lng={property.lng} />
            </span>
            {/* The Edit button is gone from the bar; this pencil keeps address, city,
                state, zip and county reachable — they live only in that dialog now. */}
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              title="Edit address & location"
              className="ml-1.5 align-middle text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"
            >
              <Pencil className="size-4" />
              <span className="sr-only">Edit address &amp; location</span>
            </button>
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
          {/* On-market only — a dead link to an off-market listing is worse than no link. */}
          {listingUrl && property.listing_status === 'on_market' && (
            <Button variant="outline" asChild>
              <a href={listingUrl} target="_blank" rel="noopener noreferrer">
                View listing
                <ExternalLink className="size-4" />
              </a>
            </Button>
          )}
          <Button onClick={() => setAddToDealOpen(true)}>
            <Plus className="size-4" />
            Add to deal
          </Button>
        </div>
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

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">{fullAddress}</p>
          <PropertyMiniMap
            lat={property.lat}
            lng={property.lng}
            address={property.address}
            city={property.city}
            state={property.state}
            zip={property.zip}
            className="min-h-[16rem] flex-1"
          />
        </div>
        <ValueEstimateCard propertyId={property.id} />
      </div>

      <PropertyTags propertyId={property.id} tags={property.tags} />

      {/* Briefing first, then the terms, then the people. On a property with a
          long conversation history the specs and the comps were both a long
          scroll below the notes — which is backwards, since they are the context
          you read the notes with. The editable detail grids stay at the bottom. */}
      <PropertySynopsis property={property} />

      <PropertyComps propertyId={property.id} />

      <PropertyOwnerCard property={property} />

      <AddToClientDialog
        property={{ id: property.id, address: property.address, city: property.city, state: property.state }}
        open={addToDealOpen}
        onOpenChange={setAddToDealOpen}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Files</h2>
          <FileSection parentType="property" parentId={property.id} />
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Tours &amp; tasks</h2>
          <PropertyTasks propertyId={property.id} />
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Tenant feedback</h2>
        <PropertyTourNotes propertyId={property.id} />
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

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Building</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4">
            <InlineEditField
              label="Notes"
              note="also shows on the property preview"
              value={property.description}
              kind="text"
              multiline
              onSave={saveField('description')}
            />
          </div>
          {/* County-owned: no onSave, so these render read-only. The lock is enforced
              in Postgres too (properties_county_owned_fields) — hiding the input here
              would still leave the REST API and every importer free to overwrite the
              roll, which is exactly how 9707 Williams Rd ended up 33,666 SF short.
              usable/net acres are GENERATED and were never editable. */}
          <InlineEditField label="Gross SF" value={property.gross_sf} kind="sf" note="county appraiser" />
          <InlineEditField label="Heated SF" value={property.heated_sf} kind="sf" note="county appraiser" />
          <InlineEditField label="Land acres" value={property.land_acres} kind="acres" note="county appraiser" />
          <InlineEditField label="Uplands" value={property.usable_acres} kind="acres" note="less wetland" />
          <InlineEditField label="Usable acres" value={property.net_usable_acres} kind="acres" note="uplands less the building" />
          <InlineEditField label="Year built" value={property.year_built} kind="number" note="county appraiser" />
          <InlineEditField label="Type" value={property.property_type} kind="select" options={typeOptions} onSave={saveField('property_type')} />
          <InlineEditField label="Sub-types" value={property.property_sub_types?.join(', ') ?? null} kind="text" onSave={saveSubTypes} />
          <InlineEditField label="Dock high doors" value={property.dock_high_doors} kind="number" onSave={saveField('dock_high_doors')} />
          <InlineEditField label="Grade level doors" value={property.grade_level_doors} kind="number" onSave={saveField('grade_level_doors')} />
          <InlineEditField label="Dock levelers" value={property.dock_levelers} kind="number" onSave={saveField('dock_levelers')} />
          <InlineEditField label="Cross docks" value={property.cross_docks} kind="boolean" onSave={saveField('cross_docks')} />
          <InlineEditField label="Truck court" note="feet" value={property.truck_court_ft} kind="number" onSave={saveField('truck_court_ft')} />
          <InlineEditField label="Column spacing" value={property.column_spacing} kind="text" onSave={saveField('column_spacing')} />
          <InlineEditField label="Sprinkler system" value={property.sprinkler_system} kind="text" onSave={saveField('sprinkler_system')} />
          <InlineEditField label="Construction material" value={property.construction_material} kind="text" onSave={saveField('construction_material')} />
          <InlineEditField label="Parking spaces" value={property.parking_spaces} kind="number" onSave={saveField('parking_spaces')} />
          <InlineEditField
            label="Clear height"
            note="feet — enter the minimum of a range"
            value={property.clear_height_ft}
            kind="number"
            onSave={saveField('clear_height_ft')}
          />
          <InlineEditField
            label="Three-phase power"
            value={property.three_phase_power}
            kind="boolean"
            onSave={saveField('three_phase_power')}
          />
          <InlineEditField label="Volts" note="e.g. 277-480" value={property.volts} kind="text" onSave={saveField('volts')} />
          <InlineEditField label="Amps" value={property.amps} kind="number" onSave={saveField('amps')} />
          <InlineEditField label="Building class" value={property.building_class} kind="text" onSave={saveField('building_class')} />
          {/* properties.title is the operating business/DBA name on county-minted
              rows (import_county_parcels writes it) — a fact about the place. The
              LISTING headline is a different thing and lives on the asking comp
              (the read-only Title row in "Listing & other"). */}
          <InlineEditField label="Business name" value={property.title} kind="text" onSave={saveField('title')} />
          <InlineEditField label="Units" value={property.num_units} kind="number" onSave={saveField('num_units')} />
          <InlineEditField label="Year renovated" value={property.year_renovated} kind="number" onSave={saveField('year_renovated')} />
          <InlineEditField label="Occupancy" value={listingEvent?.occupancy ?? null} kind="text" note="listing comp" />
          <InlineEditField label="Zoning district" value={property.zoning_district} kind="text" onSave={saveField('zoning_district')} />
          <InlineEditField label="Zoning description" value={property.zoning_description} kind="text" onSave={saveField('zoning_description')} full />
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Listing &amp; other</h2>
        {/* The listing-EVENT fields (broker, dates, sale terms, URL) live on the
            property's latest asking comp (R7) and render read-only here — edit them
            on the comp itself via the comps section's edit dialog. The rows with
            onSave are durable property facts and still write properties.*. */}
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
          <InlineEditField label="Title" value={listingEvent?.listing_title ?? null} kind="text" note="listing comp" full />
          <InlineEditField label="Broker name" value={listingEvent?.broker_name ?? null} kind="text" note="listing comp" />
          <InlineEditField label="Broker company" value={listingEvent?.broker_company ?? null} kind="text" note="listing comp" />
          <InlineEditField label="Broker phone" value={listingEvent?.broker_phone ?? null} kind="text" note="listing comp" />
          <InlineEditField label="Broker email" value={listingEvent?.broker_email ?? null} kind="text" note="listing comp" />
          <InlineEditField label="Sale type" value={listingEvent?.sale_type ?? null} kind="text" note="listing comp" />
          <InlineEditField label="Sale conditions" value={listingEvent?.sale_conditions ?? null} kind="text" note="listing comp" />
          <InlineEditField label="On ground lease" value={property.on_ground_lease} kind="boolean" onSave={saveField('on_ground_lease')} />
          <InlineEditField label="Opportunity zone" value={property.opportunity_zone} kind="boolean" onSave={saveField('opportunity_zone')} />
          <InlineEditField label="Auction" value={listingEvent?.is_auction ?? null} kind="boolean" note="listing comp" />
          <InlineEditField label="Parcel number" value={property.parcel_number} kind="text" onSave={saveField('parcel_number')} />
          <InlineEditField label="Listed" value={listingEvent?.listed_at ?? null} kind="date" note="listing comp" />
          <InlineEditField label="Days on market" value={listingEvent?.days_on_market ?? null} kind="number" note="listing comp" />
          <InlineEditField label="Listing URL" value={listingEvent?.listing_url ?? null} kind="text" note="listing comp" full />
          <InlineEditField label="Source" value={property.source} kind="text" note="auto" />
          <InlineEditField label="Specs" value={property.specs} kind="text" onSave={saveField('specs')} full />
        </dl>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">County appraiser</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={enrich.isPending}
            onClick={() => {
              // No parcel or no supported county -> ask for them instead of failing.
              if (
                !property.parcel_number?.trim() ||
                !property.county ||
                !ENRICHABLE_COUNTIES.includes(property.county)
              ) {
                setEnrichAskOpen(true)
                return
              }
              enrich.mutate(property.id, {
                onSuccess: (d) => {
                  const s = d?.results?.[0]?.status
                  if (s === 'ok') toast.success('Enriched from county appraiser')
                  else if (s === 'not_found') toast.error('No matching parcel at the appraiser')
                  else if (s === 'no_parcel' || s === 'unsupported_county') setEnrichAskOpen(true)
                  else toast.error('Could not enrich')
                },
                onError: () => toast.error('Could not enrich'),
              })
            }}
          >
            {enrich.isPending ? 'Enriching…' : property.appraiser_updated_at ? 'Refresh' : 'Enrich'}
          </Button>
        </div>
        {appraiser?.status === 'ok' ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
            <AppraiserField label="Owner" value={property.owner_name} />
            <AppraiserField label="Owner mailing" value={property.owner_mailing_address} />
            <AppraiserField
              label="DOR use code"
              value={
                property.dor_use_code
                  ? [property.dor_use_code, dorLabel(property.dor_use_code)].filter(Boolean).join(' · ')
                  : null
              }
            />
            <AppraiserField label="Just value" value={formatCurrency(property.just_value)} />
            <AppraiserField label="Assessed value" value={formatCurrency(property.assessed_value)} />
          </dl>
        ) : property.appraiser_updated_at ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No matching parcel found at the county appraiser
            {appraiser?.tried ? ` (tried ${appraiser.tried.field}=${appraiser.tried.value})` : ''}.
          </p>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Not yet pulled. Enrich fetches owner, value, DOR use code, zoning &amp; coordinates by parcel ID.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Danger zone</h2>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">Delete this property</div>
            <p className="text-xs text-muted-foreground">
              Permanently removes the record from the database. Blocked if it's still linked to a
              listing or tenant deal.
            </p>
          </div>
          <Button variant="destructive" className="shrink-0" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" />
            Delete property
          </Button>
        </div>
      </section>

      <PropertyFormDialog open={editOpen} onOpenChange={setEditOpen} property={property} />
      <EnrichParcelDialog property={property} open={enrichAskOpen} onOpenChange={setEnrichAskOpen} />
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete property?"
        description={`“${property.address}” will be permanently deleted from the database. If it's linked to a listing or tenant deal, deletion will be blocked.`}
        pending={deleteProperty.isPending}
        onConfirm={() =>
          deleteProperty.mutate(property.id, {
            onSuccess: () => {
              toast.success('Property deleted')
              navigate('/properties')
            },
            onError: (error) => toast.error(friendlyDbError(error, 'Could not delete property')),
          })
        }
      />
    </div>
  )
}
