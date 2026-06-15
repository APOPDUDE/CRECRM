import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Pencil, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AddPropertyMatchDialog } from '@/components/add-property-match-dialog'
import { ExecutedMatchDialog } from '@/components/executed-match-dialog'
import type { ExecutedResult } from '@/components/executed-match-dialog'
import { KanbanBoard } from '@/components/kanban/kanban-board'
import { ListErrorState } from '@/components/list-error-state'
import { MatchCard } from '@/components/match-card'
import { MatchSlideOver } from '@/components/match-slide-over'
import { BoardInfoPanel, SidebarSection, useInfoPanelCollapsed } from '@/components/board-info-panel'
import { DealTasks } from '@/components/deal-tasks'
import { NotesLog } from '@/components/notes-log'
import { ContactActions } from '@/components/contact-actions'
import { Badge } from '@/components/ui/badge'
import { SourceBadge } from '@/components/source-badge'
import { TenantRequirements } from '@/components/tenant-requirements'
import { TenantRepEditDialog } from '@/components/tenant-rep-edit-dialog'
import { TenantCommissionDialog } from '@/components/tenant-commission-dialog'
import { ContactFormDialog } from '@/components/contact-form-dialog'
import { CompanyFormDialog } from '@/components/company-form-dialog'
import { PropertyPreview } from '@/components/property-preview'
import { StageDateDialog } from '@/components/stage-date-dialog'
import type { DatedStage } from '@/components/stage-date-dialog'
import { contactNameOf, type Contact } from '@/hooks/use-contacts'
import type { Company } from '@/hooks/use-companies'
import { useUpdateListing } from '@/hooks/use-listings'
import {
  tenantRepMatchesKey,
  useTenantRepMatches,
  useUpdateMatchStage,
} from '@/hooks/use-matches'
import type { MatchWithRelations } from '@/hooks/use-matches'
import { useTenantRepDetail, useUpdateTenantRep } from '@/hooks/use-tenant-reps'
import { useClearFlaggedNew, useSearchListingsForTenant } from '@/hooks/use-automation'
import { formatCurrency } from '@/lib/format'
import { useSetBreadcrumb } from '@/hooks/use-breadcrumb'
import type { Enums, TablesUpdate } from '@/lib/database.types'
import { automationEnabled } from '@/lib/n8n'
import { setReppingSide } from '@/lib/repping-side'
import { mapTenantBoardColumn, matchStageLabels, tenantBoardStages } from '@/lib/stages'

type PendingMove = { match: MatchWithRelations; toStage: Enums<'match_stage'> }

const withScheme = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)

export function TenantBoardPage() {
  const { tenantRepId } = useParams()
  const navigate = useNavigate()
  const { data: tenantRep, isLoading, isError } = useTenantRepDetail(tenantRepId)
  const { data: matches = [], isError: matchesError, refetch: refetchMatches } =
    useTenantRepMatches(tenantRepId)
  const updateStage = useUpdateMatchStage(tenantRepMatchesKey(tenantRepId ?? ''))
  const updateListing = useUpdateListing()
  const updateTenantRep = useUpdateTenantRep()
  const search = useSearchListingsForTenant()
  const clearFlagged = useClearFlaggedNew()

  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [commissionOpen, setCommissionOpen] = useState(false)
  const [contactEditOpen, setContactEditOpen] = useState(false)
  const [companyEditOpen, setCompanyEditOpen] = useState(false)
  const [previewPropertyId, setPreviewPropertyId] = useState<string | null>(null)
  const [openMatchId, setOpenMatchId] = useState<string | null>(null)
  const [dateMove, setDateMove] = useState<{ match: MatchWithRelations; stage: DatedStage } | null>(
    null,
  )
  const [executedMove, setExecutedMove] = useState<PendingMove | null>(null)
  const [infoCollapsed, toggleInfo] = useInfoPanelCollapsed()

  // Returning to /repping after viewing a tenant deal should land on the tenant side.
  useEffect(() => {
    setReppingSide('tenant')
  }, [])

  // Viewing the board clears the "new match" flag (the red tag stays visible for
  // this view; it's gone next time). Fire once per tenant rep.
  const clearedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!tenantRepId || clearedFor.current === tenantRepId) return
    if (matches.some((m) => m.flagged_new)) {
      clearedFor.current = tenantRepId
      clearFlagged.mutate(tenantRepId)
    }
  }, [tenantRepId, matches, clearFlagged])

  const title =
    tenantRep?.company?.name ??
    (tenantRep?.contact ? contactNameOf(tenantRep.contact) : null) ??
    'Tenant'

  useSetBreadcrumb(tenantRep ? title : undefined)

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

  if (isError || !tenantRep) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tenant-rep')}>
          <ArrowLeft className="size-4" />
          Back to Tenant Rep
        </Button>
        <p className="text-sm text-muted-foreground">This tenant rep could not be found.</p>
      </div>
    )
  }

  const contact = tenantRep.contact
  const brokerName = tenantRep.broker ? contactNameOf(tenantRep.broker) : null

  // Pipeline snapshot from the matches already loaded for the board.
  const liveInPlay = matches.filter((m) => m.stage !== 'dead')
  const pastLoi = liveInPlay.filter((m) =>
    ['loi', 'lease_negotiation', 'executed'].includes(m.stage),
  ).length

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

  // Await every write so success only reports once linked records are synced.
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
        patch: {
          execution_date: result.executionDate,
          ...(fee != null ? { actual_fee: fee } : {}),
          ...econ,
        },
      })
      // record the fee on the tenant rep (board context) and bump it if asked
      const tenantPatch = {
        ...(result.moveTenantExecuted ? { stage: 'executed' as const } : {}),
        ...(fee != null ? { actual_fee: fee } : {}),
      }
      if (Object.keys(tenantPatch).length > 0) {
        await updateTenantRep.mutateAsync({ id: tenantRep.id, ...tenantPatch })
      }
      if (result.markListingClosed && match.listing_id) {
        await updateListing.mutateAsync({
          id: match.listing_id,
          stage: 'closed',
          ...(fee != null ? { actual_fee: fee } : {}),
        })
      }
      toast.success('Deal executed')
      setExecutedMove(null)
    } catch {
      toast.error('Could not fully sync the deal — some linked records may need a manual update')
    }
  }

  const handleFindListings = () => {
    const toastId = toast.loading('Searching the market for matching listings…')
    search.mutate(
      { tenantRepId: tenantRep.id },
      {
        onSuccess: (res) => {
          const found = res?.found ?? 0
          toast.success(
            found > 0
              ? `Found ${found} listing${found === 1 ? '' : 's'} — see Inquiring`
              : 'No new listings matched',
            { id: toastId },
          )
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'The market search failed', {
            id: toastId,
          }),
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => navigate('/tenant-rep')}
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back to Tenant Rep</span>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            {tenantRep.company && tenantRep.contact && (
              <p className="text-sm text-muted-foreground">{contactNameOf(tenantRep.contact)}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {automationEnabled() && (
            <Button variant="outline" onClick={handleFindListings} disabled={search.isPending}>
              <Search className="size-4" />
              {search.isPending ? 'Searching…' : 'Find listings'}
            </Button>
          )}
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add property
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="order-1 min-w-0 flex-1 lg:order-2">
          {matchesError ? (
            <ListErrorState message="Could not load properties in play." onRetry={() => refetchMatches()} />
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm text-muted-foreground">
                No properties in play yet — add a property to start.
              </p>
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="size-4" />
                Add property
              </Button>
            </div>
          ) : (
            <KanbanBoard
              columns={tenantBoardStages(tenantRep.deal_type)}
              items={matches}
              getId={(m) => m.id}
              getStage={(m) => mapTenantBoardColumn(m.stage)}
              onMove={handleMove}
              renderCard={(m) => (
                <MatchCard
                  match={m}
                  facing="tenant"
                  onPreview={() => setPreviewPropertyId(m.property_id)}
                  onOpen={() => setOpenMatchId(m.id)}
                />
              )}
            />
          )}
        </div>

        <aside className="order-2 w-full lg:order-1 lg:w-auto lg:shrink-0">
          <BoardInfoPanel
            entityType="tenant_rep"
            entityId={tenantRep.id}
            fileCategory="rep_agreement"
            collapsed={infoCollapsed}
            onToggle={toggleInfo}
          >
            <DealTasks entityType="tenant_rep" entityId={tenantRep.id} />

            {liveInPlay.length > 0 && (
              <SidebarSection title="Pipeline">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="font-normal">
                    {liveInPlay.length} in play
                  </Badge>
                  {pastLoi > 0 && (
                    <Badge variant="secondary" className="font-normal">
                      {pastLoi} past LOI
                    </Badge>
                  )}
                </div>
              </SidebarSection>
            )}

            {(tenantRep.stage === 'executed' || tenantRep.actual_fee != null) && (
              <SidebarSection title="Commission">
                <button
                  type="button"
                  onClick={() => setCommissionOpen(true)}
                  className="group/edit relative w-full space-y-1 rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:bg-accent"
                >
                  <Pencil className="absolute right-2 top-2 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100" />
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Fee earned</span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(tenantRep.actual_fee) ?? 'Add fee'}
                    </span>
                  </div>
                  {tenantRep.commission_pct != null && (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Commission</span>
                      <span>{tenantRep.commission_pct}%</span>
                    </div>
                  )}
                </button>
              </SidebarSection>
            )}

            {contact && (
              <SidebarSection title="Tenant contact">
                <div className="group/edit relative rounded-lg border bg-card p-3 text-sm">
                  <button
                    type="button"
                    onClick={() => setContactEditOpen(true)}
                    className="text-left"
                  >
                    <Pencil className="absolute right-2 top-2 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100" />
                    <div className="font-medium">{contactNameOf(contact)}</div>
                    {contact.title && (
                      <div className="text-xs text-muted-foreground">{contact.title}</div>
                    )}
                  </button>
                  <ContactActions phone={contact.phone} email={contact.email} />
                </div>
              </SidebarSection>
            )}

            {tenantRep.company && (
              <SidebarSection title="Tenant company">
                <div className="group/edit relative space-y-1 rounded-lg border bg-card p-3 text-sm transition-colors hover:bg-accent">
                  <button
                    type="button"
                    onClick={() => setCompanyEditOpen(true)}
                    className="block w-full text-left"
                  >
                    <Pencil className="absolute right-2 top-2 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100" />
                    <div className="font-medium">{tenantRep.company.name}</div>
                    {tenantRep.company.industry ? (
                      <div className="text-xs text-muted-foreground">
                        {tenantRep.company.industry}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic">
                        Add industry, website…
                      </div>
                    )}
                    {tenantRep.company.phone && (
                      <div className="text-xs text-muted-foreground">{tenantRep.company.phone}</div>
                    )}
                  </button>
                  {tenantRep.company.website && (
                    <a
                      href={withScheme(tenantRep.company.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 break-all text-xs text-primary hover:underline"
                    >
                      {tenantRep.company.website}
                      <ExternalLink className="size-3 shrink-0" />
                    </a>
                  )}
                </div>
              </SidebarSection>
            )}

            <SidebarSection title="Requirements">
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="group/edit relative w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent"
              >
                <Pencil className="absolute right-2 top-2 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100" />
                <TenantRequirements tenantRep={tenantRep} />
              </button>
            </SidebarSection>

            <SidebarSection title="Notes">
              <NotesLog entityType="tenant_rep" entityId={tenantRep.id} showComposer={false} />
            </SidebarSection>

            <SidebarSection title="Source">
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="group/edit relative w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent"
              >
                <Pencil className="absolute right-2 top-2 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100" />
                {tenantRep.source ? (
                  <SourceBadge source={tenantRep.source} brokerName={brokerName} />
                ) : (
                  <span className="text-xs text-muted-foreground">No source — click to set</span>
                )}
              </button>
            </SidebarSection>
          </BoardInfoPanel>
        </aside>
      </div>

      <AddPropertyMatchDialog open={addOpen} onOpenChange={setAddOpen} tenantRep={tenantRep} />
      <TenantRepEditDialog open={editOpen} onOpenChange={setEditOpen} tenantRep={tenantRep} />
      <TenantCommissionDialog
        open={commissionOpen}
        onOpenChange={setCommissionOpen}
        tenantRep={tenantRep}
      />
      {contact && (
        <ContactFormDialog
          open={contactEditOpen}
          onOpenChange={setContactEditOpen}
          contact={contact as unknown as Contact}
        />
      )}
      {tenantRep.company && (
        <CompanyFormDialog
          open={companyEditOpen}
          onOpenChange={setCompanyEditOpen}
          company={tenantRep.company as unknown as Company}
        />
      )}
      <MatchSlideOver
        matchId={openMatchId}
        open={!!openMatchId}
        onOpenChange={(open) => !open && setOpenMatchId(null)}
      />
      <PropertyPreview
        propertyId={previewPropertyId}
        open={!!previewPropertyId}
        onOpenChange={(open) => !open && setPreviewPropertyId(null)}
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
        hasTenantRep
        hasListing={!!executedMove?.match.listing_id}
        dealType={tenantRep.deal_type}
        commissionCalcContext={
          executedMove?.match.listing
            ? {
                commissionPct: executedMove.match.listing.commission_pct,
                coBrokeSplitPct: executedMove.match.listing.co_broke_split_pct,
                buildingSf: executedMove.match.property?.building_sf ?? null,
              }
            : null
        }
        pending={updateStage.isPending || updateListing.isPending || updateTenantRep.isPending}
        onConfirm={confirmExecuted}
      />
    </div>
  )
}
