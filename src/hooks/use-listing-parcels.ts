import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'

/** A parcel attached to a landlord listing (the assemblage), with its property facts. */
export type ListingParcel = {
  listing_id: string
  property_id: string
  is_primary: boolean
  created_at: string
  property:
    | {
        id: string
        address: string
        city: string | null
        state: string | null
        gross_sf: number | null
        land_acres: number | null
        parcel_number: string | null
        property_type: Enums<'property_kind'> | null
        year_built: number | null
        zoning_description: string | null
      }
    | null
}

export const listingParcelsKey = (listingId: string) => ['listing-parcels', listingId]

/** All parcels marketed under a listing (primary first). */
export function useListingParcels(listingId: string | undefined) {
  return useQuery({
    queryKey: listingParcelsKey(listingId ?? ''),
    enabled: !!listingId,
    queryFn: async (): Promise<ListingParcel[]> => {
      const { data, error } = await supabase
        .from('listing_parcels')
        .select(
          'listing_id, property_id, is_primary, created_at, property:properties!listing_parcels_property_id_fkey(id, address, city, state, gross_sf, land_acres, parcel_number, property_type, year_built, zoning_description)',
        )
        .eq('listing_id', listingId!)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as ListingParcel[]
    },
  })
}

/** Attach a parcel (existing property) to a listing via the RPC. */
export function useAddParcelToListing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { listingId: string; propertyId: string; isPrimary?: boolean }) => {
      const { error } = await supabase.rpc('add_parcel_to_listing', {
        p_listing_id: args.listingId,
        p_property_id: args.propertyId,
        p_is_primary: args.isPrimary ?? false,
      })
      if (error) throw error
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: listingParcelsKey(args.listingId) })
      qc.invalidateQueries({ queryKey: ['listing', args.listingId] })
      qc.invalidateQueries({ queryKey: ['listings'] })
      qc.invalidateQueries({ queryKey: ['properties'] })
    },
  })
}

export type ParcelSearchResult = {
  id: string
  address: string
  /** The scraped/original address, kept when the county calls the parcel something else. */
  source_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  parcel_number: string | null
  folio: string | null
}

/**
 * Typeahead over the WHOLE property book — one search box that takes an address, a city, a
 * county, a parcel number or a folio, in any order and with any punctuation.
 *
 * This runs in Postgres (`search_properties`) rather than filtering a fetched list, for the same
 * reason contact search had to move there: 17,522 properties is far past PostgREST's 1000-row
 * page, so any client-side filter is silently searching a fraction of the book. It also matches
 * the county's `site_address`, which is what the rest of the app displays — searching only the
 * stored address meant typing what you just read on screen could find nothing.
 */
export function usePropertySearch(query: string, limit = 12) {
  const q = query.trim()
  return useQuery({
    queryKey: ['property-search', q, limit],
    enabled: q.length >= 2,
    // the book barely changes minute to minute; don't refetch on every dialog re-open
    staleTime: 60_000,
    queryFn: async (): Promise<ParcelSearchResult[]> => {
      const { data, error } = await supabase.rpc('search_properties', {
        p_query: q,
        p_limit: limit,
      })
      if (error) throw error
      return (data ?? []) as ParcelSearchResult[]
    },
  })
}
