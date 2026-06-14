import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AddTenantMatchDialog } from '@/components/add-tenant-match-dialog'
import { ExecutedMatchDialog } from '@/components/executed-match-dialog'
import type { ExecutedResult } from '@/components/executed-match-dialog'
import { ListingTermsDialog } from '@/components/listing-terms-dialog'
import { KanbanBoard } from '@/components/kanban/kanban-board'
import { MatchCard } from '@/components/match-card'
import { BoardInfoPanel, SidebarSection, useInfoPanelCollapsed } from '@/components/board-info-panel'
import { PropertyMiniMap } from '@/components/property-mini-map'
import { ListErrorState } from '@/components/list-error-state'
import { MatchSlideOver } from '@/components/match-slide-over'
import { StageDateDialog } from '@/components/stage-date-dialog'
import type { DatedStage } from '@/components/stage-date-dialog'
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
import type { Enums, TablesUpdate } from '@/lib/database.types'
import { formatDate } from '@/lib/dates'
import { formatListingPrice, formatPsf, formatSf } from '@/lib/format'
import { matchStageLabels, propertyBoardStages } from '@/lib/stages'

type PendingMove = { match: MatchWithRelations; toStage: Enums<'match_stage'> }

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
  const [dateMove, setDateMove] = useState<{ match: MatchWithRelations; stage: DatedStage } | null>(
    null,
  )
  const [executedMove, setExecutedMove] = useState<PendingMove | null>(null)
  const [termsOpen, setTermsOpen] = useState(false)
  const [infoCollapsed, toggleInfo] = useInfoPanelCollapsed()

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
      setDateMove({ match, stage: 'toured' })
    } else if (toStage === 'loi' && !match.loi_date) {
      setDateMove({ match, stage: 'loi' })
    } else if (toStage === 'lease_negotiation' && !match.lease_negotiation_date) {
      setDateMove({ match, stage: 'lease_negotiation' })
    } else if (toStage === 'executed') {
      setExecutedMove({ match, toStage })
    } else {
      plainMove(match, toStage)
    }
  }

  const confirmDate = (patch: Partial<TablesUpdate<'matches'>>) => {
    if (!dateMove) return
    const { match, stage } = dateMove
    updateStage.mutate(
      { id: match.id, stage, patch },
      {
        onSuccess: () => {
          toast.success(`Moved to ${matchStageLabels[stage]}`)
          setDateMove(null)
        },
        onError: () => toast.error('Could not move match'),
      },
    )
  }

  // Await every write so the success toast only fires once the linked records are
  // actually synced; a partial failure surfaces an error instead of a false success.
  const confirmExecuted = async (result: ExecutedResult) => {
    if (!executedMove) return
    const match = executedMove.match
    const fee = result.actualFee
    const econ = Object.fromEntries(
      Object.entries(result.economics).filter(([, v]) => v != null),
    )
    try {
      await updateStage.mutateAsync({
        id: match.id,
        stage: 'executed',
        patch: { execution_date: result.executionDate, ...econ },
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
        <div className="order-1 min-w-0 flex-1 lg:order-2">
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

        <aside className="order-2 w-full lg:order-1 lg:w-auto lg:shrink-0">
          <BoardInfoPanel
            entityType="listing"
            entityId={listing.id}
            fileCategory="listing_agreement"
            collapsed={infoCollapsed}
            onToggle={toggleInfo}
          >
            {landlordContact && (
              <SidebarSection title="Landlord contact">
                <button
                  type="button"
                  onClick={() => navigate(`/contacts/${landlordContact.id}`)}
                  className="w-full rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:bg-accent"
                >
                  <div className="font-medium">{contactNameOf(landlordContact)}</div>
                  {landlordContact.title && (
                    <div className="text-xs text-muted-foreground">{landlordContact.title}</div>
                  )}
                  {landlordContact.email && <div className="mt-1 text-xs">{landlordContact.email}</div>}
                  {landlordContact.phone && <div className="text-xs">{landlordContact.phone}</div>}
                </button>
              </SidebarSection>
            )}

            {listing.property?.address && (
              <SidebarSection title="Location">
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => navigate(`/properties/${listing.property_id}`)}
                    className="block text-left text-sm font-medium hover:underline"
                  >
                    {[listing.property?.address, listing.property?.city, listing.property?.state]
                      .filter(Boolean)
                      .join(', ')}
                  </button>
                  <PropertyMiniMap
                    lat={listing.property?.lat}
                    lng={listing.property?.lng}
                    address={listing.property?.address}
                    city={listing.property?.city}
                    state={listing.property?.state}
                    zip={listing.property?.zip}
                    onClick={() => navigate(`/properties/${listing.property_id}`)}
                  />
                </div>
              </SidebarSection>
            )}

            <SidebarSection title="Terms">
              {(formatListingPrice(listing) ||
                listing.property?.building_sf != null ||
                listing.opex_psf != null ||
                listing.lease_structure ||
                listing.commission_pct != null ||
                listing.co_broke_split_pct != null ||
                listing.listing_expiration) ? (
              <div className="space-y-1 rounded-lg border bg-card p-3 text-sm">
                {listing.property?.building_sf != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Building SF</span>
                    <span className="tabular-nums">{formatSf(listing.property.building_sf)}</span>
                  </div>
                )}
                {formatListingPrice(listing) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{listing.deal_type === 'sale' ? 'Price' : listing.deal_type === 'both' ? 'Rate / Price' : 'Rate'}</span>
                    <span className="tabular-nums">{formatListingPrice(listing)}</span>
                  </div>
                )}
                {listing.opex_psf != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">OpEx</span>
                    <span className="tabular-nums">{formatPsf(listing.opex_psf)}</span>
                  </div>
                )}
                {listing.lease_structure && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Structure</span>
                    <span>{listing.lease_structure}</span>
                  </div>
                )}
                {listing.commission_pct != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Commission</span>
                    <span>{listing.commission_pct}%</span>
                  </div>
                )}
                {listing.co_broke_split_pct != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Co-broke split</span>
                    <span>{listing.co_broke_split_pct}%</span>
                  </div>
                )}
                {listing.listing_expiration && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Listing expires</span>
                    <span>{formatDate(listing.listing_expiration)}</span>
                  </div>
                )}
              </div>
              ) : (
                <p className="text-xs text-muted-foreground">No terms set yet.</p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setTermsOpen(true)}
              >
                <Pencil className="size-4" />
                Edit terms
              </Button>
            </SidebarSection>

          </BoardInfoPanel>
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
      <StageDateDialog
        stage={dateMove?.stage ?? null}
        open={!!dateMove}
        onOpenChange={(open) => !open && setDateMove(null)}
        pending={updateStage.isPending}
        onConfirm={confirmDate}
      />
      <ExecutedMatchDialog
        open={!!executedMove}
        onOpenChange={(open) => !open && setExecutedMove(null)}
        hasListing
        hasTenantRep={!!executedMove?.match.tenant_rep_id}
        dealType={listing.deal_type}
        commissionCalcContext={{
          commissionPct: listing.commission_pct,
          coBrokeSplitPct: listing.co_broke_split_pct,
          buildingSf: listing.property?.building_sf ?? null,
        }}
        pending={updateStage.isPending || updateListing.isPending || updateTenantRep.isPending}
        onConfirm={confirmExecuted}
      />
      <ListingTermsDialog open={termsOpen} onOpenChange={setTermsOpen} listing={listing} />
    </div>
  )
}
