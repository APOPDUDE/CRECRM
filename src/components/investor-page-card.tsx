import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, Eye, Globe, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/dates'
import type { Tables } from '@/lib/database.types'

type DealRoom = Tables<'deal_rooms'>

function shareUrl(slug: string) {
  return `${window.location.origin}/deal/${slug}`
}

function useDealRooms(propertyId: string) {
  return useQuery({
    queryKey: ['deal-rooms', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deal_rooms')
        .select('*')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as DealRoom[]
    },
  })
}

/**
 * Creates the room, then fills it from the comp book twice — sales and leases get
 * different bands, because a sale comp is judged on $/SF within a size range while
 * a lease comp only needs to be recent and nearby.
 */
function useCreateDealRoom(propertyId: string, grossSf: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_deal_room', {
        p_property_id: propertyId,
      })
      if (error) throw error
      const room = data as unknown as DealRoom
      const band = grossSf && grossSf > 0 ? grossSf : null

      await supabase.rpc('deal_room_fill_comps', {
        p_deal_room_id: room.id,
        p_radius_mi: 6,
        p_sf_min: band ? Math.round(band * 0.55) : undefined,
        p_sf_max: band ? Math.round(band * 1.8) : undefined,
        p_since: '2021-01-01',
        p_deal_type: 'sale',
        p_limit: 14,
        p_psf_min: 45,
        p_psf_max: 220,
      })
      await supabase.rpc('deal_room_fill_comps', {
        p_deal_room_id: room.id,
        p_radius_mi: 7,
        p_sf_min: band ? Math.round(band * 0.4) : undefined,
        p_sf_max: band ? Math.round(band * 2.2) : undefined,
        p_since: '2024-01-01',
        p_deal_type: 'lease',
        p_limit: 18,
        p_psf_min: 6,
        p_psf_max: 25,
      })
      // Asking comps are a separate basis on the page, never blended with executed
      // deals, so they are pulled as their own set with a tighter recency window.
      await supabase.rpc('deal_room_fill_comps', {
        p_deal_room_id: room.id,
        p_radius_mi: 6,
        p_sf_min: band ? Math.round(band * 0.55) : undefined,
        p_sf_max: band ? Math.round(band * 1.8) : undefined,
        p_since: '2025-01-01',
        p_deal_type: 'sale',
        p_limit: 12,
        p_kinds: ['asking'],
        p_psf_min: 45,
        p_psf_max: 220,
      })
      await supabase.rpc('deal_room_fill_comps', {
        p_deal_room_id: room.id,
        p_radius_mi: 7,
        p_sf_min: band ? Math.round(band * 0.4) : undefined,
        p_sf_max: band ? Math.round(band * 2.2) : undefined,
        p_since: '2025-01-01',
        p_deal_type: 'lease',
        p_limit: 14,
        p_kinds: ['asking'],
        p_psf_min: 6,
        p_psf_max: 25,
      })
      return room
    },
    onSuccess: (room) => {
      qc.invalidateQueries({ queryKey: ['deal-rooms', propertyId] })
      void navigator.clipboard?.writeText(shareUrl(room.slug))
      toast.success('Investor page created — link copied')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

function useSetStatus(propertyId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'published' | 'archived' }) => {
      const { error } = await supabase
        .from('deal_rooms')
        .update({ status, published_at: status === 'published' ? new Date().toISOString() : undefined })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deal-rooms', propertyId] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Share a property with investors: a public map + comps page on an unguessable URL. */
export function InvestorPageCard({
  propertyId,
  grossSf,
}: {
  propertyId: string
  grossSf: number | null
}) {
  const { data: rooms, isLoading } = useDealRooms(propertyId)
  const create = useCreateDealRoom(propertyId, grossSf)
  const setStatus = useSetStatus(propertyId)
  const [copied, setCopied] = useState<string | null>(null)

  const copy = (slug: string) => {
    void navigator.clipboard.writeText(shareUrl(slug))
    setCopied(slug)
    setTimeout(() => setCopied(null), 1600)
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Investor page</h2>
        <Button size="sm" variant="outline" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-1 h-4 w-4" />
          )}
          Create
        </Button>
      </div>

      {isLoading ? null : rooms && rooms.length > 0 ? (
        <ul className="space-y-2">
          {rooms.map((r) => (
            <li key={r.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{r.title}</span>
                <Badge variant={r.status === 'published' ? 'default' : 'secondary'}>{r.status}</Badge>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Eye className="h-3 w-3" /> {r.view_count}
                  {r.last_viewed_at && ` · last ${formatDate(r.last_viewed_at)}`}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => copy(r.slug)}>
                  {copied === r.slug ? (
                    <Check className="mr-1 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-1 h-3.5 w-3.5" />
                  )}
                  {copied === r.slug ? 'Copied' : 'Copy link'}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/deal/${r.slug}`} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setStatus.mutate({
                      id: r.id,
                      status: r.status === 'published' ? 'archived' : 'published',
                    })
                  }
                >
                  {r.status === 'published' ? 'Unpublish' : 'Publish'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No investor page yet — Create makes a public link with this property and its nearby comps.
        </p>
      )}
    </section>
  )
}
