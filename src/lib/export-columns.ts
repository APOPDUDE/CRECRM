import type { PropertyWithCounts } from '@/hooks/use-properties'
import type { OwnerContext } from '@/hooks/use-owners'
import type { CurrentAsking } from '@/hooks/use-comps'
import type { LeaseComp } from '@/hooks/use-lease-comps'
import { propertyKindLabels } from '@/components/property-form-dialog'
import { isZonedIndustrial } from '@/hooks/use-zoning-map'
import { listingUrlFromSourceKey } from '@/lib/listing-url'
import { dorBucket, dorBucketLabels } from '@/lib/zoning'

/**
 * The one export's column registry (War Room overhaul Phase 4): the union of the
 * three per-lens CSVs that used to exist (skip-trace, market, lease), grouped the way
 * the dialog shows them. Every export reads from here — adding a column is one entry,
 * not a fourth bespoke CSV builder.
 */
export type ExportCellCtx = {
  p: PropertyWithCounts
  o: OwnerContext | undefined
  ask: CurrentAsking | undefined
  lease: LeaseComp | undefined
  crossovers: Set<string> | undefined
}

export type ExportGroup = 'Property' | 'Owner / contact' | 'Market' | 'Lease' | 'Zoning'
export const EXPORT_GROUPS: ExportGroup[] = ['Property', 'Owner / contact', 'Market', 'Lease', 'Zoning']

export type ExportColumn = {
  id: string
  label: string
  group: ExportGroup
  cell: (ctx: ExportCellCtx) => string | number | null
}

const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toISOString().slice(0, 10) : null

export const EXPORT_COLUMNS: ExportColumn[] = [
  // Property — the parcel id leads because it is the join key that has to survive
  // Terrakotta and GHL and come back to the right owner.
  { id: 'parcel', label: 'Parcel ID', group: 'Property', cell: ({ p }) => p.parcel_number },
  { id: 'address', label: 'Address', group: 'Property', cell: ({ p }) => p.address },
  { id: 'city', label: 'City', group: 'Property', cell: ({ p }) => p.city },
  { id: 'state', label: 'State', group: 'Property', cell: ({ p }) => p.state },
  { id: 'zip', label: 'Zip', group: 'Property', cell: ({ p }) => p.zip },
  { id: 'county', label: 'County', group: 'Property', cell: ({ p }) => p.county },
  {
    id: 'ptype', label: 'Property Type', group: 'Property',
    cell: ({ p }) => (p.property_type ? propertyKindLabels[p.property_type] : null),
  },
  { id: 'gross_sf', label: 'Building SF', group: 'Property', cell: ({ p }) => p.gross_sf },
  { id: 'acres', label: 'Acres', group: 'Property', cell: ({ p }) => p.land_acres },
  { id: 'year_built', label: 'Year Built', group: 'Property', cell: ({ p }) => p.year_built },
  { id: 'last_sale_date', label: 'Last Sale Date', group: 'Property', cell: ({ p }) => p.last_sale_date },
  { id: 'last_sale_price', label: 'Last Sale Price', group: 'Property', cell: ({ p }) => p.last_sale_price },
  // Crossed-URL bug (2026-08-18): scraped comp URLs can carry a NEIGHBORING listing's
  // id (claim-by-address in the importer), so the link is derived from this row's own
  // source_key — the one field that IS the property's listing identity. Non-listing
  // keys (parcel:/addr:/null) export an empty cell.
  {
    id: 'listing_url', label: 'Listing URL', group: 'Property',
    cell: ({ p }) => listingUrlFromSourceKey(p.source_key, p.source_address ?? p.address, p.city),
  },
  { id: 'crm_id', label: 'CRM Property ID', group: 'Property', cell: ({ p }) => p.id },

  // Owner / contact
  {
    id: 'owner_name', label: 'Owner Name', group: 'Owner / contact',
    cell: ({ p, o }) => o?.owner_name ?? p.owner_name,
  },
  {
    id: 'owner_mailing', label: 'Owner Mailing Address', group: 'Owner / contact',
    cell: ({ p, o }) => o?.owner_mailing_address ?? p.owner_mailing_address,
  },
  {
    id: 'owner_verified', label: 'Owner Verified', group: 'Owner / contact',
    cell: ({ o }) => (o?.owner_contact_verified ? 'yes' : 'no'),
  },
  {
    id: 'owner_tags', label: 'Owner Tags', group: 'Owner / contact',
    cell: ({ o }) => (o?.owner_tags ?? []).join('; '),
  },
  { id: 'contact_name', label: 'Owner Contact Name', group: 'Owner / contact', cell: ({ o }) => o?.best_contact_name ?? null },
  { id: 'contact_phone', label: 'Owner Contact Phone', group: 'Owner / contact', cell: ({ o }) => o?.best_contact_phone ?? null },
  { id: 'contact_email', label: 'Owner Contact Email', group: 'Owner / contact', cell: ({ o }) => o?.best_contact_email ?? null },
  { id: 'contact_count', label: 'Known Contacts', group: 'Owner / contact', cell: ({ o }) => o?.owner_contact_count ?? 0 },
  { id: 'last_contacted', label: 'Last Contacted', group: 'Owner / contact', cell: ({ o }) => date(o?.last_contacted_at) },

  // Market
  {
    id: 'market_status', label: 'Market Status', group: 'Market',
    cell: ({ p }) => (p.listing_status === 'off_market' ? 'off market' : 'on market'),
  },
  {
    // "never" vs "was listed" is the split that matters for cold lists
    id: 'was_on_market', label: 'Was On Market', group: 'Market',
    cell: ({ o }) => (o?.was_on_market ? 'yes' : 'never'),
  },
  { id: 'off_market_days', label: 'Days Off Market', group: 'Market', cell: ({ o }) => o?.off_market_days ?? null },
  { id: 'days_on_market', label: 'Days On Market', group: 'Market', cell: ({ ask }) => ask?.days_on_market ?? null },
  { id: 'ask_rate', label: 'Asking Rate $/SF', group: 'Market', cell: ({ ask }) => ask?.rate ?? null },
  { id: 'ask_price', label: 'Asking Price', group: 'Market', cell: ({ ask }) => ask?.price ?? null },

  // Lease — the representative lease the table shows (the window's match, else the
  // soonest-running). Rows without one export empty cells.
  {
    id: 'tenant', label: 'Tenant Company', group: 'Lease',
    cell: ({ lease }) => lease?.tenant_company_name ?? lease?.tenant_name ?? null,
  },
  { id: 'leased_sf', label: 'Leased SF', group: 'Lease', cell: ({ lease }) => lease?.sf ?? null },
  { id: 'lease_rate', label: 'Lease Rate $/SF', group: 'Lease', cell: ({ lease }) => lease?.executed_lease_rate_psf ?? null },
  { id: 'lease_structure', label: 'Structure', group: 'Lease', cell: ({ lease }) => lease?.lease_structure ?? null },
  { id: 'lease_term', label: 'Term (mo)', group: 'Lease', cell: ({ lease }) => lease?.term_months ?? null },
  { id: 'lease_signed', label: 'Signed', group: 'Lease', cell: ({ lease }) => lease?.signed_date ?? null },
  { id: 'lease_commencement', label: 'Commencement', group: 'Lease', cell: ({ lease }) => lease?.commencement_date ?? null },
  { id: 'lease_expiration', label: 'Expiration', group: 'Lease', cell: ({ lease }) => lease?.expiration_date ?? null },
  { id: 'lease_months_left', label: 'Months To Expiry', group: 'Lease', cell: ({ lease }) => lease?.months_to_expiry ?? null },
  { id: 'dm_status', label: 'DM Status', group: 'Lease', cell: ({ lease }) => lease?.dm_status ?? null },
  { id: 'dm_name', label: 'DM Name', group: 'Lease', cell: ({ lease }) => lease?.dm_name ?? null },
  { id: 'dm_title', label: 'DM Title', group: 'Lease', cell: ({ lease }) => lease?.dm_title ?? null },
  { id: 'dm_phone', label: 'DM Phone', group: 'Lease', cell: ({ lease }) => lease?.dm_phone ?? null },
  { id: 'dm_email', label: 'DM Email', group: 'Lease', cell: ({ lease }) => lease?.dm_email ?? null },

  // Zoning
  { id: 'zoning_code', label: 'Zoning Code', group: 'Zoning', cell: ({ p }) => p.zoning_code },
  { id: 'zoning_type', label: 'Zoning Type', group: 'Zoning', cell: ({ p }) => p.zoning_type },
  {
    id: 'zoned_industrial', label: 'Zoned Industrial OK', group: 'Zoning',
    cell: ({ p, crossovers }) => (isZonedIndustrial(p, crossovers) ? 'yes' : 'no'),
  },
  { id: 'zoning_jurisdiction', label: 'Zoning Jurisdiction', group: 'Zoning', cell: ({ p }) => p.zoning_jurisdiction },
  { id: 'dor_code', label: 'DOR Use Code', group: 'Zoning', cell: ({ p }) => p.dor_use_code },
  {
    id: 'county_use', label: 'County Use', group: 'Zoning',
    cell: ({ p }) => {
      const b = dorBucket(p.dor_use_code)
      return b ? dorBucketLabels[b] : null
    },
  },
]

export const ALL_EXPORT_COLUMN_IDS = EXPORT_COLUMNS.map((c) => c.id)

/** Ids of columns whose cells read the lease — the dialog fetches comps only for these. */
export const LEASE_EXPORT_COLUMN_IDS = new Set(
  EXPORT_COLUMNS.filter((c) => c.group === 'Lease').map((c) => c.id),
)
