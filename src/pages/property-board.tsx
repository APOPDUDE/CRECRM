import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { AddTenantMatchDialog } from '@/components/add-tenant-match-dialog'
import { ExecutedMatchDialog } from '@/components/executed-match-dialog'
import type { ExecutedResult } from '@/components/executed-match-dialog'
import { KanbanBoard } from '@/components/kanban/kanban-board'
import { MatchCard } from '@/components/match-card'
import { ListErrorState } from '@/components/list-error-state'
import { MatchSlideOver } from '@/components/match-slide-over'
import { NotesLog } from '@/components/notes-log'
import { TourDateDialog } from '@/components/tour-date-dialog'
import { contactNameOf } from '@/hooks/use-contacts'
import { useListingDetail, useUpdateListing } from '@/hooks/use-listings'
import {
  listingMatchesKey,
  useListingMatches,
  useUpdateMatchStage,
} from '@/hooks/use-matches'
import type { MatchWithRelations } from '@/hooks/use-matches'
import { useUpdateTenantRep } from '@/hooks/use-tenant-reps'
import { useSetBreadcrumb } from '@/hooks/use-breadcrumb'
import type { Enums } from '@/lib/database.types'
import { formatDate } from '@/lib/dates'
import { formatListingPrice } from '@/lib/format'
import { matchStageLabels, propertyBoardStages } from '@/lib/stages'

type PendingMove = { match: MatchWithRelations; toStage: Enums<'match_stage'> }

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

export function PropertyBoardPage() {
  const { listingId } = useParams()
  const navigate = useNavigate()
  const { data: listing, isLoading, isError } = useListingDetail(listingId)
  const { data: matches = [], isError: matchesError, refetch: refetchMatches } =
    useListingMatches(listingId)
  const updateStage = useUpdateMatchStage(listingMatchesKey(listingId ?? ''))
  const updateListing = useUpdateListing()
  const updateTenantRep = useUpdateTenantRep()

  const [addOpen, setAddOpen] = useState(false)
  const [openMatchId, setOpenMatchId] = useState<string | null>(null)
  const [tourMove, setTourMove] = useState<PendingMove | null>(null)
  const [executedMove, setExecutedMove] = useState<PendingMove | null>(null)

  useSetBreadcrumb(listing?.property?.address)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="flex gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-48 w-64" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !listing) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/landlord-rep')}>
          <ArrowLeft className="size-4" />
          Back to Landlord Rep
        </Button>
        <p className="text-sm text-muted-foreground">This listing could not be found.</p>
      </div>
    )
  }

  const columns = propertyBoardStages(listing.deal_type)
  const landlordContact = listing.landlord_contact

  const plainMove = (match: MatchWithRelations, toStage: Enums<'match_stage'>) => {
    const fromStage = match.stage
    updateStage.mutate(
      { id: match.id, stage: toStage },
      {
        onSuccess: () =>
          toast.success(`Moved to ${matchStageLabels[toStage]}`, {
            action: {
              label: 'Undo',
              onClick: () => updateStage.mutate({ id: match.id, stage: fromStage }),
            },
          }),
        onError: () => toast.error('Could not move match'),
      },
    )
  }

  const handleMove = (match: MatchWithRelations, toStageStr: string) => {
    const toStage = toStageStr as Enums<'match_stage'>
    if (toStage === 'toured' && !match.tour_date) {
      setTourMove({ match, toStage })
    } else if (toStage === 'executed') {
      setExecutedMove({ match, toStage })
    } else {
      plainMove(match, toStage)
    }
  }

  const confirmTour = (tourDate: string) => {
    if (!tourMove) return
    updateStage.mutate(
      { id: tourMove.match.id, stage: 'toured', patch: { tour_date: tourDate } },
      {
        onSuccess: () => {
          toast.success('Tour logged')
          setTourMove(null)
        },
        onError: () => toast.error('Could not log tour'),
      },
    )
  }

  // Await every write so the success toast only fires once the linked records are
  // actually synced; a partial failure surfaces an error instead of a false success.
  const confirmExecuted = async (result: ExecutedResult) => {
    if (!executedMove) return
    const match = executedMove.match
    const fee = result.actualFee
    try {
      await updateStage.mutateAsync({
        id: match.id,
        stage: 'executed',
        patch: { execution_date: result.executionDate },
      })
      // record the fee on the listing (board context) and close it if asked
      const listingPatch = {
        ...(result.markListingClosed ? { stage: 'closed' as const } : {}),
        ...(fee != null ? { actual_fee: fee } : {}),
      }
      if (Object.keys(listingPatch).length > 0) {
        await updateListing.mutateAsync({ id: listing.id, ...listingPatch })
      }
      if (result.moveTenantExecuted && match.tenant_rep_id) {
        await updateTenantRep.mutateAsync({
          id: match.tenant_rep_id,
          stage: 'executed',
          ...(fee != null ? { actual_fee: fee } : {}),
        })
      }
      toast.success('Deal executed')
      setExecutedMove(null)
    } catch {
      toast.error('Could not fully sync the deal — some linked records may need a manual update')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => navigate('/landlord-rep')}
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back to Landlord Rep</span>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{listing.property?.address}</h1>
            {listing.landlord && (
              <p className="text-sm text-muted-foreground">{listing.landlord.name}</p>
            )}
          </div>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add tenant
        </Button>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          {matchesError ? (
            <ListErrorState message="Could not load prospects." onRetry={() => refetchMatches()} />
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm text-muted-foreground">
                No tenant inquiries yet — add a tenant to start moving prospects.
              </p>
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="size-4" />
                Add tenant
              </Button>
            </div>
          ) : (
            <KanbanBoard
              columns={columns}
              items={matches}
              getId={(m) => m.id}
              getStage={(m) => m.stage}
              onMove={handleMove}
              renderCard={(m) => <MatchCard match={m} facing="property" onOpen={() => setOpenMatchId(m.id)} />}
            />
          )}
        </div>

        <aside className="w-full shrink-0 space-y-4 lg:w-72">
          {landlordContact && (
            <SidebarSection title="Landlord contact">
              <div className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{contactNameOf(landlordContact)}</div>
                {landlordContact.title && (
                  <div className="text-xs text-muted-foreground">{landlordContact.title}</div>
                )}
                {landlordContact.email && <div className="mt-1 text-xs">{landlordContact.email}</div>}
                {landlordContact.phone && <div className="text-xs">{landlordContact.phone}</div>}
              </div>
            </SidebarSection>
          )}

          <SidebarSection title="Terms">
            <div className="space-y-1 rounded-lg border p-3 text-sm">
              {formatListingPrice(listing) && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{listing.deal_type === 'sale' ? 'Price' : 'Rate'}</span>
                  <span className="tabular-nums">{formatListingPrice(listing)}</span>
                </div>
              )}
              {listing.commission_pct != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Commission</span>
                  <span>{listing.commission_pct}%</span>
                </div>
              )}
              {listing.listing_expiration && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Listing expires</span>
                  <span>{formatDate(listing.listing_expiration)}</span>
                </div>
              )}
            </div>
          </SidebarSection>

          {listing.landlord_requirements && (
            <SidebarSection title="Landlord requirements">
              <p className="rounded-lg border p-3 text-sm whitespace-pre-wrap">
                {listing.landlord_requirements}
              </p>
            </SidebarSection>
          )}

          <Separator />
          <SidebarSection title="Notes">
            <NotesLog entityType="listing" entityId={listing.id} />
          </SidebarSection>
        </aside>
      </div>

      <AddTenantMatchDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        listingId={listing.id}
        propertyId={listing.property_id}
      />
      <MatchSlideOver
        matchId={openMatchId}
        open={!!openMatchId}
        onOpenChange={(open) => !open && setOpenMatchId(null)}
      />
      <TourDateDialog
        open={!!tourMove}
        onOpenChange={(open) => !open && setTourMove(null)}
        pending={updateStage.isPending}
        onConfirm={confirmTour}
      />
      <ExecutedMatchDialog
        open={!!executedMove}
        onOpenChange={(open) => !open && setExecutedMove(null)}
        hasListing
        hasTenantRep={!!executedMove?.match.tenant_rep_id}
        pending={updateStage.isPending || updateListing.isPending || updateTenantRep.isPending}
        onConfirm={confirmExecuted}
      />
    </div>
  )
}
