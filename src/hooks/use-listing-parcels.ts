import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

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
        building_sf: number | null
        land_acres: number | null
        parcel_number: string | null
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
          'listing_id, property_id, is_primary, created_at, property:properties!listing_parcels_property_id_fkey(id, address, city, state, building_sf, land_acres, parcel_number)',
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
  city: string | null
  state: string | null
  parcel_number: string | null
}

/** Typeahead: find existing properties by address and/or parcel id (the add-parcel autofill). */
export function usePropertySearch(address: string, parcel: string) {
  // PostgREST .or() is comma/paren-delimited, so strip those from the user's text.
  const a = address.replace(/[,()]/g, ' ').trim()
  const p = parcel.replace(/[,()]/g, ' ').trim()
  const parts: string[] = []
  if (a.length >= 2) parts.push(`address.ilike.%${a}%`)
  if (p.length >= 2) parts.push(`parcel_number.ilike.%${p}%`)
  return useQuery({
    queryKey: ['property-search', a, p],
    enabled: parts.length > 0,
    queryFn: async (): Promise<ParcelSearchResult[]> => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, address, city, state, parcel_number')
        .or(parts.join(','))
        .order('address')
        .limit(8)
      if (error) throw error
      return (data ?? []) as ParcelSearchResult[]
    },
  })
}
