import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { geocodeAddress } from '@/lib/geocode'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

/**
 * Background-geocode properties that lack coordinates. Runs in the browser (whose
 * Referer satisfies Nominatim's policy — the scrape actor returns no lat/lng, and
 * the n8n server IP is rate-limited). Processes a small batch per mount.
 */
export function useGeocodeMissing(enabled = true) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('properties')
        .select('id, address, city, state, zip')
        .is('lat', null)
        .not('address', 'is', null)
        .limit(25)
      if (!data || cancelled) return
      let any = false
      for (const p of data) {
        if (cancelled) return
        const geo = await geocodeAddress(p)
        if (geo) {
          await supabase.from('properties').update({ lat: geo.lat, lng: geo.lng }).eq('id', p.id)
          any = true
        }
        await new Promise((r) => setTimeout(r, 1100))
      }
      if (any && !cancelled) {
        queryClient.invalidateQueries({ queryKey: ['deal-map'] })
        queryClient.invalidateQueries({ queryKey: ['properties'] })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, queryClient])
}

export type Property = Tables<'properties'>

/** Property plus embedded linked-deal counts (listings + pursuits). */
export type PropertyWithCounts = Property & {
  listings: { count: number }[]
  matches: { count: number }[]
}

/** Total linked deals on a property: landlord listings + tenant pursuits. */
export function dealCount(p: Pick<PropertyWithCounts, 'listings' | 'matches'>): number {
  return (p.listings?.[0]?.count ?? 0) + (p.matches?.[0]?.count ?? 0)
}

export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('*, listings(count), matches:pursuits(count)')
        .order('address')
      if (error) throw error
      return data as unknown as PropertyWithCounts[]
    },
  })
}

export type PropertyListing = Pick<
  Tables<'listings'>,
  'id' | 'deal_type' | 'stage' | 'status' | 'asking_rate_psf' | 'asking_price' | 'lost_reason'
> & {
  landlord: Pick<Tables<'companies'>, 'id' | 'name'> | null
}

export type PropertyMatch = Pick<
  Tables<'pursuits'>,
  'id' | 'stage' | 'flagged_new' | 'inquiry_date'
> & {
  /** alias of client_id, for routing to the tenant board */
  tenant_rep_id: string
  tenant_company: Pick<Tables<'companies'>, 'id' | 'name'> | null
  tenant_contact: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
}

type PropertyPursuitRow = Pick<Tables<'pursuits'>, 'id' | 'stage' | 'flagged_new' | 'inquiry_date'> & {
  client_id: string
  client: {
    company: Pick<Tables<'companies'>, 'id' | 'name'> | null
    contact: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
  } | null
}

/** Landlord listings + tenant pursuits tied to a property — its association view. */
export function usePropertyDeals(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['property-deals', propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const [listingsRes, pursuitsRes] = await Promise.all([
        supabase
          .from('listings')
          .select(
            'id, deal_type, stage, status, asking_rate_psf, asking_price, lost_reason, landlord:companies!listings_landlord_company_id_fkey(id, name)',
          )
          .eq('property_id', propertyId!)
          .order('created_at', { ascending: false }),
        supabase
          .from('pursuits')
          .select(
            'id, stage, flagged_new, inquiry_date, client_id, client:clients!pursuits_client_id_fkey(company:companies!clients_company_id_fkey(id, name), contact:contacts!clients_contact_id_fkey(id, first_name, last_name))',
          )
          .eq('property_id', propertyId!)
          .order('inquiry_date', { ascending: false }),
      ])
      if (listingsRes.error) throw listingsRes.error
      if (pursuitsRes.error) throw pursuitsRes.error
      const matches: PropertyMatch[] = ((pursuitsRes.data ?? []) as unknown as PropertyPursuitRow[]).map(
        (p) => ({
          id: p.id,
          stage: p.stage,
          flagged_new: p.flagged_new,
          inquiry_date: p.inquiry_date,
          tenant_rep_id: p.client_id,
          tenant_company: p.client?.company ?? null,
          tenant_contact: p.client?.contact ?? null,
        }),
      )
      return {
        listings: (listingsRes.data ?? []) as unknown as PropertyListing[],
        matches,
      }
    },
  })
}

/** The asking figure to show for a property: PSF rate (lease) or total price (sale). */
export function propertyAsking(p: Pick<Property, 'asking_rate_psf' | 'asking_price'>): {
  rate: number | null
  price: number | null
} {
  return { rate: p.asking_rate_psf, price: p.asking_price }
}

export type MatchStage = Enums<'pursuit_stage'>

export function useProperty(id: string | undefined) {
  return useQuery({
    queryKey: ['properties', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*').eq('id', id!).single()
      if (error) throw error
      return data
    },
  })
}

function invalidatePropertyViews(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['properties'] })
  queryClient.invalidateQueries({ queryKey: ['property-deals'] })
  queryClient.invalidateQueries({ queryKey: ['deal-map'] })
}

/** On-demand county-appraiser enrichment for one property (via the edge function). */
export function useEnrichProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (propertyId: string) => {
      const { data, error } = await supabase.functions.invoke('enrich-appraiser', {
        body: { property_ids: [propertyId] },
      })
      if (error) throw error
      return data as { tally?: Record<string, number>; results?: { status: string }[] }
    },
    onSuccess: () => invalidatePropertyViews(queryClient),
  })
}

export function useCreateProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'properties'>) => {
      let v = values
      // geocode manually-entered properties so they appear on the Deal Map
      if (v.address && v.lat == null && v.lng == null) {
        const geo = await geocodeAddress(v)
        if (geo) v = { ...v, lat: geo.lat, lng: geo.lng }
      }
      const { data, error } = await supabase.from('properties').insert(v).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => invalidatePropertyViews(queryClient),
  })
}

export function useUpdateProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'properties'> & { id: string }) => {
      let v = values
      // re-geocode when the address is edited and coordinates weren't set explicitly
      if (v.address && v.lat == null && v.lng == null) {
        const geo = await geocodeAddress(v)
        if (geo) v = { ...v, lat: geo.lat, lng: geo.lng }
      }
      const { data, error } = await supabase.from('properties').update(v).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => invalidatePropertyViews(queryClient),
  })
}

export function useDeleteProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('properties').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['properties'] }),
  })
}
