import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { addMonths, format } from 'date-fns'
import { ArrowLeft, Pencil, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AddTenantMatchDialog } from '@/components/add-tenant-match-dialog'
import { ExecutedMatchDialog } from '@/components/executed-match-dialog'
import type { ExecutedResult } from '@/components/executed-match-dialog'
import { ListingTermsDialog } from '@/components/listing-terms-dialog'
import { KanbanBoard } from '@/components/kanban/kanban-board'
import { MatchCard } from '@/components/match-card'
import { BoardInfoPanel, SidebarSection, useInfoPanelCollapsed } from '@/components/board-info-panel'
import { AddListingParcelDialog } from '@/components/add-listing-parcel-dialog'
import { propertyKindLabels } from '@/components/property-form-dialog'
import { ContactActions } from '@/components/contact-actions'
import { PropertyMiniMap } from '@/components/property-mini-map'
import { ListErrorState } from '@/components/list-error-state'
import { MatchSlideOver } from '@/components/match-slide-over'
import { StageDateDialog } from '@/components/stage-date-dialog'
import type { DatedStage } from '@/components/stage-date-dialog'
import { contactNameOf } from '@/hooks/use-contacts'
import { useListingDetail } from '@/hooks/use-listings'
import { useListingParcels } from '@/hooks/use-listing-parcels'
import { useUnits, useDeleteUnit, unitSizeLabel } from '@/hooks/use-units'
import { AddUnitDialog } from '@/components/add-unit-dialog'
import {
  propertyMatchesKey,
  useDeleteMatch,
  useExecutePursuit,
  usePropertyMatches,
  useUpdateMatchStage,
} from '@/hooks/use-matches'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import type { MatchWithRelations } from '@/hooks/use-matches'
import { useSetBreadcrumb } from '@/hooks/use-breadcrumb'
import { useCreateTask, usePaymentReceivedToggle } from '@/hooks/use-tasks'
import type { Enums, TablesUpdate } from '@/lib/database.types'
import { formatDate } from '@/lib/dates'
import { formatCurrency, formatListingPrice, formatPsf, formatSf } from '@/lib/format'
import { calculateCommission } from '@/lib/commission'
import { setReppingSide } from '@/lib/repping-side'
import { pursuitStageLabels, propertyBoardStages } from '@/lib/stages'

type PendingMove = { match: MatchWithRelations; toStage: Enums<'pursuit_stage'> }

export function PropertyBoardPage() {
  const { listingId } = useParams()
  const navigate = useNavigate()
  const { data: listing, isLoading, isError } = useListingDetail(listingId)
  const propertyId = listing?.property_id
  const { data: matches = [], isError: matchesError, refetch: refetchMatches } =
    usePropertyMatches(propertyId)
  const { data: parcels = [] } = useListingParcels(listingId)
  const { data: units = [] } = useUnits(parcels.map((p) => p.property_id))
  const updateStage = useUpdateMatchStage(propertyMatchesKey(propertyId ?? ''))
  const createTask = useCreateTask()
  const paymentToggle = usePaymentReceivedToggle()
  const executePursuit = useExecutePursuit()
  const deleteMatch = useDeleteMatch()
  const deleteUnit = useDeleteUnit()

  const [addOpen, setAddOpen] = useState(false)
  const [addParcelOpen, setAddParcelOpen] = useState(false)
  const [addUnitOpen, setAddUnitOpen] = useState(false)
  const [openMatchId, setOpenMatchId] = useState<string | null>(null)
  const [dateMove, setDateMove] = useState<{ match: MatchWithRelations; stage: DatedStage } | null>(
    null,
  )
  const [executedMove, setExecutedMove] = useState<PendingMove | null>(null)
  const [removingMatch, setRemovingMatch] = useState<MatchWithRelations | null>(null)
  const [termsOpen, setTermsOpen] = useState(false)
  const [infoCollapsed, toggleInfo] = useInfoPanelCollapsed()

  // Returning to /repping after viewing a landlord deal should land on the landlord side.
  useEffect(() => {
    setReppingSide('landlord')
  }, [])

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
  const parcelOptions = parcels.map((p) => ({
    id: p.property_id,
    address: p.property?.address ?? 'Property',
  }))
  const totalSf = parcels.reduce((s, p) => s + (p.property?.building_sf ?? 0), 0)
  const totalAcres = parcels.reduce((s, p) => s + (p.property?.land_acres ?? 0), 0)
  const primaryProperty = parcels.find((p) => p.is_primary)?.property ?? parcels[0]?.property ?? null

  const plainMove = (match: MatchWithRelations, toStage: Enums<'pursuit_stage'>) => {
    const fromStage = match.stage
    updateStage.mutate(
      { id: match.id, stage: toStage },
      {
        onSuccess: () =>
          toast.success(`Moved to ${pursuitStageLabels[toStage]}`, {
            action: {
              label: 'Undo',
              onClick: () => updateStage.mutate({ id: match.id, stage: fromStage }),
            },
          }),
        onError: () => toast.error('Could not move pursuit'),
      },
    )
  }

  const handleMove = (match: MatchWithRelations, toStageStr: string) => {
    const toStage = toStageStr as Enums<'pursuit_stage'>
    if (toStage === 'touring' && !match.tour_date) {
      setDateMove({ match, stage: 'touring' })
    } else if (toStage === 'executed') {
      setExecutedMove({ match, toStage })
    } else {
      plainMove(match, toStage)
    }
  }

  const confirmDate = (patch: Partial<TablesUpdate<'pursuits'>>) => {
    if (!dateMove) return
    const { match, stage } = dateMove
    updateStage.mutate(
      { id: match.id, stage, patch },
      {
        onSuccess: () => {
          toast.success(`Moved to ${pursuitStageLabels[stage]}`)
          if (stage === 'touring' && patch.tour_date) {
            const tourDate = patch.tour_date as string
            const tourTime = (patch.tour_time as string | null | undefined) ?? null
            createTask.mutate({
              owner_id: match.owner_id,
              kind: 'tour',
              title: `Tour — ${match.property?.address ?? 'property'}`,
              due_date: tourDate,
              due_at: tourTime ? new Date(`${tourDate}T${tourTime}`).toISOString() : null,
              pursuit_id: match.id,
              contact_id: match.client?.contact_id ?? null,
            })
          }
          setDateMove(null)
        },
        onError: () => toast.error('Could not move pursuit'),
      },
    )
  }

  // Execute the pursuit: the RPC writes the comp, stamps the fee, and optionally
  // closes the property's listing + the client.
  const confirmExecuted = async (result: ExecutedResult) => {
    if (!executedMove) return
    const match = executedMove.match
    try {
      await executePursuit.mutateAsync({
        pursuitId: match.id,
        terms: {
          executed_date: result.executedDate,
          ...(result.actualFee != null ? { actual_fee: result.actualFee } : {}),
          ...result.economics,
          close_client: result.closeClient,
          close_listing: result.closeListing,
        },
      })
      // Seed the first "payment received?" reminder a month out, same as executing from
      // the tenant board — follow-ups then run every two weeks until marked received.
      paymentToggle.mutate({
        pursuitId: match.id,
        received: false,
        ownerId: match.owner_id,
        title: `Payment received? — ${match.property?.address ?? 'deal'}`,
        nextDue: format(addMonths(new Date(), 1), 'yyyy-MM-dd'),
      })
      toast.success('Deal executed')
      setExecutedMove(null)
    } catch {
      toast.error('Could not execute the deal')
    }
  }

  // Pipeline snapshot from the pursuits already loaded for the board.
  const liveProspects = matches.filter((m) => m.stage !== 'passed')
  const pastLoi = liveProspects.filter((m) =>
    ['negotiation', 'executed'].includes(m.stage),
  ).length
  const oldestDays = (() => {
    const dates = liveProspects.map((m) => m.inquiry_date).filter(Boolean) as string[]
    if (!dates.length) return null
    const oldest = dates.reduce((a, b) => (a < b ? a : b))
    return Math.max(0, Math.round((Date.now() - new Date(oldest).getTime()) / 86400000))
  })()

  // Live commission estimate from the asking terms (shown on the Terms panel).
  const commissionEstimate = calculateCommission({
    dealType: listing.deal_type === 'both' ? 'lease' : listing.deal_type,
    commissionPct: listing.commission_pct,
    coBrokeSplitPct: listing.co_broke_split_pct,
    buildingSf: listing.property?.building_sf ?? null,
    executedRatePsf: listing.asking_rate_psf,
    executedPrice: listing.asking_price,
    termMonths: null, // calculateCommission defaults to a 5-year term
  })
  const commissionNeedsInput =
    listing.commission_pct == null ||
    (listing.deal_type !== 'sale' && listing.property?.building_sf == null)

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
            <h1 className="text-xl font-semibold">
              {listing.property?.address}
              {listing.landlord_contact?.first_name && (
                <span className="text-muted-foreground"> — {listing.landlord_contact.first_name}</span>
              )}
            </h1>
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
              renderCard={(m) => (
                <MatchCard
                  match={m}
                  facing="property"
                  onOpen={() => setOpenMatchId(m.id)}
                  onRemove={() => setRemovingMatch(m)}
                />
              )}
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
                <div className="rounded-lg border bg-card p-3 text-sm">
                  <button
                    type="button"
                    onClick={() => navigate(`/contacts/${landlordContact.id}`)}
                    className="text-left"
                  >
                    <div className="font-medium hover:underline">
                      {contactNameOf(landlordContact)}
                    </div>
                    {landlordContact.title && (
                      <div className="text-xs text-muted-foreground">{landlordContact.title}</div>
                    )}
                  </button>
                  <ContactActions phone={landlordContact.phone} email={landlordContact.email} />
                </div>
              </SidebarSection>
            )}

            <SidebarSection title={`Available units${units.length > 0 ? ` (${units.length})` : ''}`}>
              <div className="space-y-2">
                {units.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No units yet — add the spaces available for lease.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {units.map((u) => {
                      const sub = [
                        u.label ? unitSizeLabel(u) : null,
                        u.asking_rate_psf != null ? formatPsf(u.asking_rate_psf) : null,
                        parcels.length > 1
                          ? parcels.find((p) => p.property_id === u.property_id)?.property?.address
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                      return (
                        <li
                          key={u.id}
                          className="flex items-start justify-between gap-2 rounded-lg border bg-card p-2.5 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{u.label || unitSizeLabel(u)}</div>
                            {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              deleteUnit.mutate(u.id, {
                                onSuccess: () => toast.success('Unit removed'),
                                onError: () => toast.error('Could not remove the unit'),
                              })
                            }
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            title="Remove unit"
                          >
                            <X className="size-4" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setAddUnitOpen(true)}
                  disabled={parcels.length === 0}
                >
                  <Plus className="size-4" />
                  Add unit
                </Button>
              </div>
            </SidebarSection>

            <SidebarSection title={`Parcels${parcels.length > 1 ? ` (${parcels.length})` : ''}`}>
              <div className="space-y-2">
                {parcels.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No parcels linked yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {parcels.map((lp) => {
                      const size =
                        lp.property?.building_sf != null
                          ? formatSf(lp.property.building_sf)
                          : lp.property?.land_acres != null
                            ? `${lp.property.land_acres} AC`
                            : null
                      return (
                        <li key={lp.property_id} className="rounded-lg border bg-card p-2.5 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => navigate(`/properties/${lp.property_id}`)}
                              className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                            >
                              {lp.property?.address ?? 'Property'}
                            </button>
                            {lp.is_primary && (
                              <Badge variant="secondary" className="shrink-0 font-normal">
                                Primary
                              </Badge>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[
                              [lp.property?.city, lp.property?.state].filter(Boolean).join(', '),
                              lp.property?.parcel_number
                                ? `Parcel ${lp.property.parcel_number}`
                                : null,
                              size,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {(totalSf > 0 || totalAcres > 0) && (
                  <div className="flex justify-between rounded-lg border bg-muted/40 px-2.5 py-2 text-xs">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-medium tabular-nums">
                      {[
                        totalSf > 0 ? formatSf(totalSf) : null,
                        totalAcres > 0 ? `${Math.round(totalAcres * 100) / 100} AC` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setAddParcelOpen(true)}
                >
                  <Plus className="size-4" />
                  Add parcel
                </Button>
              </div>
            </SidebarSection>

            <SidebarSection title="Property information">
              {primaryProperty ? (
                <div className="space-y-1 rounded-lg border bg-card p-3 text-sm">
                  {primaryProperty.building_sf != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Building SF</span>
                      <span className="tabular-nums">{formatSf(primaryProperty.building_sf)}</span>
                    </div>
                  )}
                  {primaryProperty.land_acres != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Land acres</span>
                      <span className="tabular-nums">{primaryProperty.land_acres} AC</span>
                    </div>
                  )}
                  {primaryProperty.property_type && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type</span>
                      <span>{propertyKindLabels[primaryProperty.property_type]}</span>
                    </div>
                  )}
                  {primaryProperty.year_built != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Year built</span>
                      <span className="tabular-nums">{primaryProperty.year_built}</span>
                    </div>
                  )}
                  {primaryProperty.zoning_description && (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Zoning</span>
                      <span className="truncate text-right">{primaryProperty.zoning_description}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => navigate(`/properties/${listing.property_id}`)}
                    className="mt-1 w-full border-t pt-1.5 text-left text-xs text-primary hover:underline"
                  >
                    View full property →
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No property details yet.</p>
              )}
            </SidebarSection>

            {liveProspects.length > 0 && (
              <SidebarSection title="Pipeline">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="font-normal">
                    {liveProspects.length} in play
                  </Badge>
                  {pastLoi > 0 && (
                    <Badge variant="secondary" className="font-normal">
                      {pastLoi} past LOI
                    </Badge>
                  )}
                  {oldestDays != null && (
                    <Badge variant="secondary" className="font-normal">
                      Oldest {oldestDays}d
                    </Badge>
                  )}
                </div>
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
                {commissionEstimate.netFee != null ? (
                  <div className="mt-1 flex justify-between border-t pt-1.5 font-medium">
                    <span>Est. fee</span>
                    <span className="tabular-nums text-primary">
                      {formatCurrency(commissionEstimate.netFee)}
                    </span>
                  </div>
                ) : commissionNeedsInput ? (
                  <div className="mt-1 border-t pt-1.5 text-xs text-muted-foreground">
                    {listing.commission_pct == null
                      ? 'Add commission %'
                      : 'Add building SF'}{' '}
                    to estimate the fee.
                  </div>
                ) : null}
              </div>
              ) : (
                <p className="text-xs text-muted-foreground">No terms set yet — add them to estimate the fee.</p>
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
        propertyId={listing.property_id}
      />
      <AddListingParcelDialog
        listingId={listing.id}
        existingPropertyIds={parcels.map((p) => p.property_id)}
        open={addParcelOpen}
        onOpenChange={setAddParcelOpen}
      />
      <AddUnitDialog
        parcels={parcelOptions}
        defaultPropertyId={listing.property_id}
        open={addUnitOpen}
        onOpenChange={setAddUnitOpen}
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
        dealType={listing.deal_type}
        commissionCalcContext={{
          commissionPct: listing.commission_pct,
          coBrokeSplitPct: listing.co_broke_split_pct,
          buildingSf: listing.property?.building_sf ?? null,
        }}
        pending={executePursuit.isPending}
        onConfirm={confirmExecuted}
      />
      <ListingTermsDialog open={termsOpen} onOpenChange={setTermsOpen} listing={listing} />
      <ConfirmDeleteDialog
        open={!!removingMatch}
        onOpenChange={(open) => !open && setRemovingMatch(null)}
        title="Remove from board?"
        description="This removes this prospect from the board. The property record itself is kept."
        pending={deleteMatch.isPending}
        onConfirm={() => {
          if (!removingMatch) return
          deleteMatch.mutate(removingMatch.id, {
            onSuccess: () => {
              toast.success('Removed from board')
              setRemovingMatch(null)
            },
            onError: () => toast.error('Could not remove it'),
          })
        }}
      />
    </div>
  )
}
