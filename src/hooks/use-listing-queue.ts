import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'

/**
 * How well a scraped listing landed in the book:
 * - `matched`   the parcel-first path resolved it to a parcel
 * - `partial`   mappable (has coordinates) but no parcel identity
 * - `unmatched` a ghost — portfolio listings, "Address unavailable"
 */
export type MatchState = 'matched' | 'partial' | 'unmatched'
export type ReviewStatus = 'new' | 'attached' | 'dismissed'

export interface QueueListing {
  property_id: string
  address: string
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  property_type: Enums<'property_kind'> | null
  gross_sf: number | null
  land_acres: number | null
  lat: number | null
  lng: number | null
  parcel_number: string | null
  source_key: string | null
  title: string | null
  first_seen: string
  match_state: MatchState
  review_status: ReviewStatus
  attached_property_id: string | null
  attached_address: string | null
  note: string | null
  reviewed_at: string | null
  asking_deal_type: string | null
  sale_price: number | null
  asking_lease_rate_psf: number | null
  cap_rate_pct: number | null
  listing_url: string | null
  broker_name: string | null
  broker_company: string | null
  listing_title: string | null
  listing_description: string | null
  /** the property is listed BOTH for lease and for sale; we show the newer side */
  also_listed_other_side: boolean | null
}

export interface QueueCounts {
  matched?: number
  partial?: number
  unmatched?: number
  new_total?: number
  attached?: number
  dismissed?: number
}

export interface QueueFilters {
  status: ReviewStatus
  match: MatchState | null
  types: string[] | null
  search: string
  limit: number
  offset: number
}

/** The triage queue. Counts are always over the unreviewed set, whatever the filter. */
export function useListingQueue(f: QueueFilters) {
  return useQuery({
    queryKey: ['listing-queue', f],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: QueueListing[]; total: number; counts: QueueCounts }> => {
      const { data, error } = await supabase.rpc('listing_queue', {
        p_status: f.status,
        p_match: f.match ?? undefined,
        p_types: f.types ?? undefined,
        p_search: f.search || undefined,
        p_limit: f.limit,
        p_offset: f.offset,
      })
      if (error) throw error
      const d = data as unknown as { rows: QueueListing[]; total: number; counts: QueueCounts }
      return { rows: d?.rows ?? [], total: d?.total ?? 0, counts: d?.counts ?? {} }
    },
  })
}

/** Dismiss a listing, or bind a ghost onto a real property in the book. */
export function useReviewListing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      propertyId: string
      status: ReviewStatus
      attachTo?: string | null
      note?: string | null
    }) => {
      const { error } = await supabase.rpc('review_listing', {
        p_property_id: v.propertyId,
        p_status: v.status,
        p_attach_to: v.attachTo ?? undefined,
        p_note: v.note ?? undefined,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['listing-queue'] }),
    onError: (e: Error) => toast.error(e.message),
  })
}
