import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * The investor page's data contract. Everything here comes back from the single
 * anon-callable `public_deal_room(slug)` function, which whitelists its fields —
 * no contact, client, pursuit, outreach or commission data can reach this page.
 */
export interface DealRoomComp {
  id: string
  deal_type: 'lease' | 'sale'
  kind: 'asking' | 'executed' | 'transfer'
  sort_order: number | null
  featured: boolean
  note: string | null
  sf: number | null
  rate_psf: number | null
  asking_psf: number | null
  price_psf: number | null
  sale_price: number | null
  cap_rate_pct: number | null
  lease_structure: string | null
  term_months: number | null
  free_rent_months: number | null
  ti_psf: number | null
  opex_psf: number | null
  executed_at: string | null
  commencement_date: string | null
  tenant_name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  lat: number | null
  lng: number | null
  year_built: number | null
  gross_sf: number | null
  land_acres: number | null
  property_type: string | null
  miles: number | null
}

export interface DealRoomPayload {
  room: {
    slug: string
    title: string
    subtitle: string | null
    summary: string | null
    headline_price: number | null
    headline_price_psf: number | null
    headline_rate_psf: number | null
    lease_structure: string | null
    highlights: string[]
    broker_name: string | null
    broker_phone: string | null
    broker_email: string | null
    show_comp_detail: boolean
    published_at: string | null
  }
  property: {
    address: string
    city: string | null
    state: string | null
    zip: string | null
    lat: number | null
    lng: number | null
    property_type: string | null
    gross_sf: number | null
    heated_sf: number | null
    land_acres: number | null
    usable_acres: number | null
    year_built: number | null
    year_renovated: number | null
    building_class: string | null
    stories: number | null
    clear_height_ft: number | null
    dock_high_doors: number | null
    grade_level_doors: number | null
    column_spacing: string | null
    sprinkler_system: string | null
    three_phase_power: boolean | null
    parking_spaces: number | null
    truck_court_ft: number | null
    zoning_district: string | null
    zoning_description: string | null
    zoning_type: string | null
    county: string | null
    parcel_number: string | null
    just_value: number | null
    specs: string | null
    description: string | null
    photo_urls: string[] | null
  }
  comps: DealRoomComp[]
  stats: {
    lease_median_psf: number | null
    sale_median_psf: number | null
    lease_count: number
    sale_count: number
  }
}

/** Public — runs on the anon key, no session required. */
export function useDealRoom(slug: string | undefined) {
  return useQuery({
    queryKey: ['deal-room', slug],
    enabled: !!slug,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<DealRoomPayload | null> => {
      const { data, error } = await supabase.rpc('public_deal_room', { p_slug: slug! })
      if (error) throw error
      return (data as unknown as DealRoomPayload | null) ?? null
    },
  })
}

/** Google Maps directions for a lat/lng, falling back to the address string. */
export function directionsUrl(
  lat: number | null | undefined,
  lng: number | null | undefined,
  address?: string | null,
): string {
  const q = lat != null && lng != null ? `${lat},${lng}` : (address ?? '')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

/** The single line a comp card leads with. */
export function compHeadline(c: DealRoomComp): string {
  if (c.deal_type === 'sale') {
    const parts = [
      c.price_psf != null ? `$${c.price_psf.toFixed(2)}/SF` : null,
      c.sale_price != null ? `$${c.sale_price.toLocaleString('en-US')}` : null,
    ].filter(Boolean)
    return parts.join(' · ') || 'Sale'
  }
  const rate = c.rate_psf ?? c.asking_psf
  const parts = [
    rate != null ? `$${rate.toFixed(2)}/SF` : null,
    c.lease_structure,
    c.term_months != null ? `${c.term_months} mo` : null,
  ].filter(Boolean)
  return parts.join(' · ') || 'Lease'
}

/** Aug 2024 — comps read by month, never by day. */
export function compMonth(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}
