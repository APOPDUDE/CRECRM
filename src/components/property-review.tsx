import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PropertyMiniMap } from '@/components/property-mini-map'
import { supabase } from '@/lib/supabase'
import { formatSf } from '@/lib/format'
import type { Property } from '@/hooks/use-properties'

/**
 * Card-by-card review of the current filtered list (Alex 2026-08-24: "a tinder
 * style with the properties... i get to see the close aerial shot [with] the
 * property highlight[ed]"). Each card is the aerial mini-map — Esri World
 * Imagery with the county parcel outline drawn and fitted — plus the facts
 * that matter at a glance.
 *
 * Keep advances; Remove tags the property 'not interested' — the same tag the
 * rail's Tags filter and the GHL sync already speak, so a review session's
 * rejects can be excluded from any future canvass with one filter tap rather
 * than being deleted. Undo restores the exact tag array Remove replaced.
 *
 * Tag writes go straight to PostgREST WITHOUT the usual invalidate-per-mutation:
 * a rapid swipe session would otherwise refetch the whole book once per swipe.
 * One invalidation runs when the dialog closes.
 */
export function PropertyReview({
  open,
  onOpenChange,
  properties,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  properties: Property[]
}) {
  const queryClient = useQueryClient()
  const [idx, setIdx] = useState(0)
  // What each decision changed, so Undo can put it back exactly.
  const [trail, setTrail] = useState<
    { id: string; action: 'keep' | 'remove'; prevTags: string[] | null }[]
  >([])
  const [busy, setBusy] = useState(false)

  // The list is frozen at open: mid-session tag writes must not reshuffle the
  // deck under the reviewer.
  const [deck, setDeck] = useState<Property[]>([])
  useEffect(() => {
    if (open) {
      setDeck(properties)
      setIdx(0)
      setTrail([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const current = deck[idx]
  const finished = open && deck.length > 0 && idx >= deck.length
  const removedCount = useMemo(() => trail.filter((t) => t.action === 'remove').length, [trail])

  const close = useCallback(
    (next: boolean) => {
      if (!next && trail.some((t) => t.action === 'remove')) {
        // one refetch for the whole session, not one per swipe
        queryClient.invalidateQueries({ queryKey: ['properties'] })
      }
      onOpenChange(next)
    },
    [trail, queryClient, onOpenChange],
  )

  const keep = useCallback(() => {
    if (!current || busy) return
    setTrail((t) => [...t, { id: current.id, action: 'keep', prevTags: null }])
    setIdx((i) => i + 1)
  }, [current, busy])

  const remove = useCallback(async () => {
    if (!current || busy) return
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('properties')
        .select('tags')
        .eq('id', current.id)
        .single()
      if (error) throw error
      const prev = (data.tags as string[] | null) ?? null
      const next = prev?.includes('not interested') ? prev : [...(prev ?? []), 'not interested']
      const { error: e2 } = await supabase
        .from('properties')
        .update({ tags: next })
        .eq('id', current.id)
      if (e2) throw e2
      setTrail((t) => [...t, { id: current.id, action: 'remove', prevTags: prev }])
      setIdx((i) => i + 1)
    } catch (e) {
      toast.error(`Could not tag property: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [current, busy])

  const undo = useCallback(async () => {
    const last = trail[trail.length - 1]
    if (!last || busy) return
    setBusy(true)
    try {
      if (last.action === 'remove') {
        const { error } = await supabase
          .from('properties')
          .update({ tags: last.prevTags && last.prevTags.length ? last.prevTags : null })
          .eq('id', last.id)
        if (error) throw error
      }
      setTrail((t) => t.slice(0, -1))
      setIdx((i) => Math.max(0, i - 1))
    } catch (e) {
      toast.error(`Could not undo: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [trail, busy])

  // Arrow keys are the swipe: left = remove, right = keep.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); keep() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); void remove() }
      else if (e.key === 'Backspace' || e.key.toLowerCase() === 'u') { e.preventDefault(); void undo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, keep, remove, undo])

  const acres =
    current?.land_acres != null ? `${Number(current.land_acres).toFixed(2)} ac` : null
  const sf = current?.gross_sf ? formatSf(current.gross_sf) : null

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[92vh] w-full max-w-3xl flex-col gap-3 overflow-hidden">
        <DialogTitle className="flex flex-wrap items-baseline justify-between gap-2 pr-8">
          <span className="truncate">
            {finished || !current
              ? 'Review'
              : (current.site_address ?? current.address)}
          </span>
          {deck.length > 0 && !finished && (
            <span className="shrink-0 text-sm font-normal text-muted-foreground">
              {Math.min(idx + 1, deck.length)} of {deck.length}
            </span>
          )}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Review each property on an aerial map and keep or remove it.
        </DialogDescription>

        {deck.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing to review — the current list is empty.
          </p>
        ) : finished ? (
          <div className="space-y-4 py-10 text-center">
            <p className="text-sm">
              Done — {deck.length} reviewed, {removedCount} removed
              {removedCount > 0 && ' (tagged "not interested")'}.
            </p>
            <Button onClick={() => close(false)}>Close</Button>
          </div>
        ) : current ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {current.city && <span>{current.city}</span>}
              {current.county && <Badge variant="outline">{current.county}</Badge>}
              {acres && <Badge variant="outline">{acres}</Badge>}
              {sf && <Badge variant="outline">{sf}</Badge>}
              {current.dor_use_code && <Badge variant="outline">DOR {current.dor_use_code}</Badge>}
              {current.owner_name && <span className="truncate">{current.owner_name}</span>}
            </div>

            {/* keyed so each property builds a fresh map fitted to ITS parcel */}
            <PropertyMiniMap
              key={current.id}
              lat={current.lat}
              lng={current.lng}
              address={current.site_address ?? current.address}
              city={current.city}
              state={current.state}
              zip={current.zip}
              parcelNumber={current.parcel_number}
              className="h-[52vh] min-h-64 flex-1"
            />

            <div className="flex items-center justify-center gap-3">
              <Button
                size="lg"
                variant="outline"
                className="min-w-32 border-amber-300 text-amber-700 hover:bg-amber-50"
                disabled={busy}
                onClick={() => void remove()}
              >
                <X className="size-5" />
                Remove
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title="Undo (U)"
                disabled={busy || trail.length === 0}
                onClick={() => void undo()}
              >
                <RotateCcw className="size-4" />
              </Button>
              <Button
                size="lg"
                className="min-w-32 bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={busy}
                onClick={keep}
              >
                <Check className="size-5" />
                Keep
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              ← remove · → keep · U undo
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
