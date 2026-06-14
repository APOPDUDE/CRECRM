import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'
import { contactNameOf } from '@/hooks/use-contacts'
import { formatListingPrice } from '@/lib/format'
import { matchStageLabels } from '@/lib/stages'

export type DealStatus = 'active' | 'closed' | 'lost'

/** A located deal (landlord listing or tenant match) for the Dashboard map. */
export type MapDeal = {
  id: string
  kind: 'listing' | 'match'
  lat: number
  lng: number
  address: string
  city: string | null
  state: string | null
  status: DealStatus
  title: string
  stageLabel: string
  price: string | null
  href: string | null
}

const listingStageLabels: Record<string, string> = {
  proposal: 'Proposal',
  listed: 'Listed',
  closed: 'Closed',
}

type PropCoords = {
  id: string
  address: string
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
}

type ListingRow = {
  id: string
  deal_type: 'lease' | 'sale'
  stage: string
  status: 'active' | 'lost'
  asking_rate_psf: number | null
  asking_price: number | null
  landlord: { name: string } | null
  property: PropCoords | null
}

type MatchRow = {
  id: string
  stage: Enums<'match_stage'>
  tenant_rep_id: string | null
  listing_id: string | null
  tenant_company: { name: string } | null
  tenant_contact: { first_name: string; last_name: string | null } | null
  property: PropCoords | null
}

/** All located deals — listings + matches joined to their property's coordinates. */
export function useDealMap() {
  return useQuery({
    queryKey: ['deal-map'],
    queryFn: async (): Promise<MapDeal[]> => {
      const [listingsRes, matchesRes] = await Promise.all([
        supabase
          .from('listings')
          .select(
            'id, deal_type, stage, status, asking_rate_psf, asking_price, landlord:companies!listings_landlord_company_id_fkey(name), property:properties!listings_property_id_fkey(id, address, city, state, lat, lng)',
          ),
        supabase
          .from('matches')
          .select(
            'id, stage, tenant_rep_id, listing_id, tenant_company:companies!matches_tenant_company_id_fkey(name), tenant_contact:contacts!matches_tenant_contact_id_fkey(first_name, last_name), property:properties!matches_property_id_fkey(id, address, city, state, lat, lng)',
          ),
      ])
      if (listingsRes.error) throw listingsRes.error
      if (matchesRes.error) throw matchesRes.error

      const deals: MapDeal[] = []

      for (const l of (listingsRes.data ?? []) as unknown as ListingRow[]) {
        const p = l.property
        if (!p || p.lat == null || p.lng == null) continue
        const status: DealStatus =
          l.status === 'lost' ? 'lost' : l.stage === 'closed' ? 'closed' : 'active'
        deals.push({
          id: l.id,
          kind: 'listing',
          lat: Number(p.lat),
          lng: Number(p.lng),
          address: p.address,
          city: p.city,
          state: p.state,
          status,
          title: l.landlord?.name ?? 'Landlord listing',
          stageLabel: `${l.deal_type === 'sale' ? 'Sale' : 'Lease'} · ${listingStageLabels[l.stage] ?? l.stage}`,
          price: formatListingPrice(l),
          href: `/landlord-rep/${l.id}`,
        })
      }

      for (const m of (matchesRes.data ?? []) as unknown as MatchRow[]) {
        const p = m.property
        if (!p || p.lat == null || p.lng == null) continue
        const status: DealStatus =
          m.stage === 'dead' ? 'lost' : m.stage === 'executed' ? 'closed' : 'active'
        const who =
          m.tenant_company?.name ??
          (m.tenant_contact ? contactNameOf(m.tenant_contact) : 'Tenant prospect')
        deals.push({
          id: m.id,
          kind: 'match',
          lat: Number(p.lat),
          lng: Number(p.lng),
          address: p.address,
          city: p.city,
          state: p.state,
          status,
          title: who,
          stageLabel: matchStageLabels[m.stage],
          price: null,
          href: m.tenant_rep_id
            ? `/tenant-rep/${m.tenant_rep_id}`
            : m.listing_id
              ? `/landlord-rep/${m.listing_id}`
              : null,
        })
      }

      return deals
    },
  })
}
