import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { AddPropertyMatchDialog } from '@/components/add-property-match-dialog'
import { ExecutedMatchDialog } from '@/components/executed-match-dialog'
import type { ExecutedResult } from '@/components/executed-match-dialog'
import { KanbanBoard } from '@/components/kanban/kanban-board'
import { ListErrorState } from '@/components/list-error-state'
import { MatchCard } from '@/components/match-card'
import { MatchSlideOver } from '@/components/match-slide-over'
import { NotesLog } from '@/components/notes-log'
import { SourceBadge } from '@/components/source-badge'
import { contactNameOf } from '@/hooks/use-contacts'
import { useUpdateListing } from '@/hooks/use-listings'
import {
  tenantRepMatchesKey,
  useTenantRepMatches,
  useUpdateMatchStage,
} from '@/hooks/use-matches'
import type { MatchWithRelations } from '@/hooks/use-matches'
import { useTenantRepDetail, useUpdateTenantRep } from '@/hooks/use-tenant-reps'
import { useSetBreadcrumb } from '@/hooks/use-breadcrumb'
import type { Enums } from '@/lib/database.types'
import { formatSf } from '@/lib/format'
import { mapTenantBoardColumn, matchStageLabels, tenantBoardStages } from '@/lib/stages'

type PendingMove = { match: MatchWithRelations; toStage: Enums<'match_stage'> }

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

function sizeSummary(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return `${min.toLocaleString('en-US')}–${formatSf(max)}`
  if (min != null) return `${formatSf(min)}+`
  if (max != null) return `Up to ${formatSf(max)}`
  return null
}

export function TenantBoardPage() {
  const { tenantRepId } = useParams()
  const navigate = useNavigate()
  const { data: tenantRep, isLoading, isError } = useTenantRepDetail(tenantRepId)
  const { data: matches = [], isError: matchesError, refetch: refetchMatches } =
    useTenantRepMatches(tenantRepId)
  const updateStage = useUpdateMatchStage(tenantRepMatchesKey(tenantRepId ?? ''))
  const updateListing = useUpdateListing()
  const updateTenantRep = useUpdateTenantRep()

  const [addOpen, setAddOpen] = useState(false)
  const [openMatchId, setOpenMatchId] = useState<string | null>(null)
  const [executedMove, setExecutedMove] = useState<PendingMove | null>(null)

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
  const reqSize = sizeSummary(tenantRep.size_min_sf, tenantRep.size_max_sf)
  const brokerName = tenantRep.broker ? contactNameOf(tenantRep.broker) : null

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
    if (toStage === 'executed') {
      setExecutedMove({ match, toStage })
    } else {
      plainMove(match, toStage)
    }
  }

  // Await every write so success only reports once linked records are synced.
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
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add property
        </Button>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
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
              columns={tenantBoardStages}
              items={matches}
              getId={(m) => m.id}
              getStage={(m) => mapTenantBoardColumn(m.stage)}
              onMove={handleMove}
              renderCard={(m) => (
                <MatchCard match={m} facing="tenant" onOpen={() => setOpenMatchId(m.id)} />
              )}
            />
          )}
        </div>

        <aside className="w-full shrink-0 space-y-4 lg:w-72">
          {contact && (
            <SidebarSection title="Tenant contact">
              <div className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{contactNameOf(contact)}</div>
                {contact.title && (
                  <div className="text-xs text-muted-foreground">{contact.title}</div>
                )}
                {contact.email && <div className="mt-1 text-xs">{contact.email}</div>}
                {contact.phone && <div className="text-xs">{contact.phone}</div>}
              </div>
            </SidebarSection>
          )}

          {(reqSize ||
            tenantRep.must_haves ||
            tenantRep.target_area ||
            tenantRep.budget) && (
            <SidebarSection title="Requirements">
              <div className="space-y-1 rounded-lg border p-3 text-sm">
                {reqSize && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Size</span>
                    <span className="tabular-nums">{reqSize}</span>
                  </div>
                )}
                {tenantRep.target_area && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Area</span>
                    <span className="text-right">{tenantRep.target_area}</span>
                  </div>
                )}
                {tenantRep.budget && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Budget</span>
                    <span className="text-right">{tenantRep.budget}</span>
                  </div>
                )}
                {tenantRep.must_haves && (
                  <p className="pt-1 whitespace-pre-wrap">{tenantRep.must_haves}</p>
                )}
              </div>
            </SidebarSection>
          )}

          {tenantRep.source && (
            <SidebarSection title="Source">
              <div className="rounded-lg border p-3 text-sm">
                <SourceBadge source={tenantRep.source} brokerName={brokerName} />
              </div>
            </SidebarSection>
          )}

          <Separator />
          <SidebarSection title="Notes">
            <NotesLog entityType="tenant_rep" entityId={tenantRep.id} />
          </SidebarSection>
        </aside>
      </div>

      <AddPropertyMatchDialog open={addOpen} onOpenChange={setAddOpen} tenantRep={tenantRep} />
      <MatchSlideOver
        matchId={openMatchId}
        open={!!openMatchId}
        onOpenChange={(open) => !open && setOpenMatchId(null)}
      />
      <ExecutedMatchDialog
        open={!!executedMove}
        onOpenChange={(open) => !open && setExecutedMove(null)}
        hasTenantRep
        hasListing={!!executedMove?.match.listing_id}
        pending={updateStage.isPending || updateListing.isPending || updateTenantRep.isPending}
        onConfirm={confirmExecuted}
      />
    </div>
  )
}
