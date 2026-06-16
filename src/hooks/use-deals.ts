import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'
import { contactNameOf } from '@/hooks/use-contacts'
import { formatListingPrice } from '@/lib/format'
import { pursuitStageLabels, listingStageLabels } from '@/lib/stages'

export type DealStatus = 'active' | 'closed' | 'lost'

/** A located deal (landlord listing or tenant pursuit) for the Dashboard map. */
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
  deal_type: Enums<'deal_type'>
  stage: Enums<'listing_stage'>
  status: Enums<'engagement_status'>
  asking_rate_psf: number | null
  asking_price: number | null
  landlord: { name: string } | null
  property: PropCoords | null
}

type PursuitRow = {
  id: string
  stage: Enums<'pursuit_stage'>
  client_id: string
  client: {
    company: { name: string } | null
    contact: { first_name: string; last_name: string | null } | null
  } | null
  property: PropCoords | null
}

/** All located deals — listings + pursuits joined to their property's coordinates. */
export function useDealMap() {
  return useQuery({
    queryKey: ['deal-map'],
    queryFn: async (): Promise<MapDeal[]> => {
      const [listingsRes, pursuitsRes] = await Promise.all([
        supabase
          .from('listings')
          .select(
            'id, deal_type, stage, status, asking_rate_psf, asking_price, landlord:companies!listings_landlord_company_id_fkey(name), property:properties!listings_property_id_fkey(id, address, city, state, lat, lng)',
          ),
        supabase
          .from('pursuits')
          .select(
            'id, stage, client_id, client:clients!pursuits_client_id_fkey(company:companies!clients_company_id_fkey(name), contact:contacts!clients_contact_id_fkey(first_name, last_name)), property:properties!pursuits_property_id_fkey(id, address, city, state, lat, lng)',
          ),
      ])
      if (listingsRes.error) throw listingsRes.error
      if (pursuitsRes.error) throw pursuitsRes.error

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

      for (const m of (pursuitsRes.data ?? []) as unknown as PursuitRow[]) {
        const p = m.property
        if (!p || p.lat == null || p.lng == null) continue
        const status: DealStatus =
          m.stage === 'passed' ? 'lost' : m.stage === 'executed' ? 'closed' : 'active'
        const who =
          m.client?.company?.name ??
          (m.client?.contact ? contactNameOf(m.client.contact) : 'Tenant prospect')
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
          stageLabel: pursuitStageLabels[m.stage],
          price: null,
          href: m.client_id ? `/tenant-rep/${m.client_id}` : null,
        })
      }

      return deals
    },
  })
}
