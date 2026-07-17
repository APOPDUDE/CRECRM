import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ExternalLink, Pencil, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { AddPropertyMatchDialog } from '@/components/add-property-match-dialog'
import { FindListingsDialog } from '@/components/find-listings-dialog'
import { ExecutedMatchDialog } from '@/components/executed-match-dialog'
import type { ExecutedResult } from '@/components/executed-match-dialog'
import { KanbanBoard } from '@/components/kanban/kanban-board'
import { ListErrorState } from '@/components/list-error-state'
import { MatchCard } from '@/components/match-card'
import { BoardInfoPanel, SidebarSection, useInfoPanelCollapsed } from '@/components/board-info-panel'
import { DealTasks } from '@/components/deal-tasks'
import { NotesLog } from '@/components/notes-log'
import { ContactActions } from '@/components/contact-actions'
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
import {
  tenantRepMatchesKey,
  useDeleteMatch,
  useExecutePursuit,
  useTenantRepMatches,
  useUpdateMatchStage,
} from '@/hooks/use-matches'
import { PassedRail } from '@/components/passed-rail'
import { Checkbox } from '@/components/ui/checkbox'
import type { MatchWithRelations } from '@/hooks/use-matches'
import { useTenantRepDetail } from '@/hooks/use-tenant-reps'
import { paymentRungMessage, useCreateTask, usePaymentReceivedToggle } from '@/hooks/use-tasks'
import { useClearFlaggedNew } from '@/hooks/use-automation'
import { formatCurrency } from '@/lib/format'
import { useSetBreadcrumb } from '@/hooks/use-breadcrumb'
import type { Enums, TablesUpdate } from '@/lib/database.types'
import { automationEnabled } from '@/lib/n8n'
import { setReppingSide } from '@/lib/repping-side'
import { pursuitLabelsFor, tenantBoardStages } from '@/lib/stages'

type PendingMove = { match: MatchWithRelations; toStage: Enums<'pursuit_stage'> }

const withScheme = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)

export function TenantBoardPage() {
  const { tenantRepId } = useParams()
  const navigate = useNavigate()
  const { data: tenantRep, isLoading, isError } = useTenantRepDetail(tenantRepId)
  const { data: matches = [], isError: matchesError, refetch: refetchMatches } =
    useTenantRepMatches(tenantRepId)
  const updateStage = useUpdateMatchStage(tenantRepMatchesKey(tenantRepId ?? ''))
  const createTask = useCreateTask()
  const executePursuit = useExecutePursuit()
  const paymentToggle = usePaymentReceivedToggle()
  const deleteMatch = useDeleteMatch()
  const clearFlagged = useClearFlaggedNew()

  const [addOpen, setAddOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [addMode, setAddMode] = useState<'manual' | 'paste'>('manual')
  const openAdd = (mode: 'manual' | 'paste') => {
    setAddMode(mode)
    setAddOpen(true)
  }
  const [editOpen, setEditOpen] = useState(false)
  const [commissionOpen, setCommissionOpen] = useState(false)
  const [contactEditOpen, setContactEditOpen] = useState(false)
  const [companyEditOpen, setCompanyEditOpen] = useState(false)
  const [previewPropertyId, setPreviewPropertyId] = useState<string | null>(null)
  const [dateMove, setDateMove] = useState<{ match: MatchWithRelations; stage: DatedStage } | null>(
    null,
  )
  const [executedMove, setExecutedMove] = useState<PendingMove | null>(null)
  const [infoCollapsed, toggleInfo] = useInfoPanelCollapsed()

  // Removing a property from the board is SOFT: it moves to the Passed rail on the left,
  // where it can be restored — a hard delete only happens from inside the rail.
  const passed = matches.filter((m) => m.stage === 'passed')
  const softPass = (m: MatchWithRelations) => {
    const from = m.stage
    updateStage.mutate(
      { id: m.id, stage: 'passed' },
      {
        onSuccess: () =>
          toast.success('Moved to Passed', {
            action: { label: 'Undo', onClick: () => updateStage.mutate({ id: m.id, stage: from }) },
          }),
        onError: () => toast.error('Could not move it'),
      },
    )
  }
  const restorePassed = (id: string) =>
    updateStage.mutate(
      { id, stage: 'inquiring' },
      {
        onSuccess: () => toast.success('Restored to Inquiring'),
        onError: () => toast.error('Could not restore it'),
      },
    )
  const deletePassed = (id: string) =>
    deleteMatch.mutate(id, {
      onSuccess: () => toast.success('Deleted permanently'),
      onError: () => toast.error('Could not delete it'),
    })

  // Returning to /repping after viewing a tenant deal should land on the tenant side.
  useEffect(() => {
    setReppingSide('tenant')
  }, [])

  // Viewing the board clears the "new" flag (the tag stays visible for this view).
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
        <p className="text-sm text-muted-foreground">This client could not be found.</p>
      </div>
    )
  }

  const contact = tenantRep.contact
  const brokerName = tenantRep.broker ? contactNameOf(tenantRep.broker) : null

  const stageLabels = pursuitLabelsFor(tenantRep.deal_type)
  const executedPursuit = matches.find((m) => m.stage === 'executed') ?? null

  const plainMove = (match: MatchWithRelations, toStage: Enums<'pursuit_stage'>) => {
    const fromStage = match.stage
    updateStage.mutate(
      { id: match.id, stage: toStage },
      {
        onSuccess: () =>
          toast.success(`Moved to ${stageLabels[toStage]}`, {
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
    } else if (toStage === 'due_diligence' && !match.dd_expiration_date) {
      setDateMove({ match, stage: 'due_diligence' })
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
          toast.success(`Moved to ${stageLabels[stage]}`)
          // Touring with a date/time becomes a scheduled tour task.
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
          if (stage === 'due_diligence' && patch.dd_expiration_date) {
            createTask.mutate({
              owner_id: match.owner_id,
              kind: 'follow_up',
              title: `DD expires — ${match.property?.address ?? 'property'}`,
              due_date: patch.dd_expiration_date as string,
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
  // closes the client + the property's listing.
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
      // Seed the first payment check right away so it's on the task list immediately.
      // The collection ladder is anchored to the close date: follow-up day 4, formal
      // notice day 14, final notice day 30, then weekly.
      paymentToggle.mutate({
        pursuitId: match.id,
        received: false,
        ownerId: match.owner_id,
        title: `Payment received? — ${match.property?.address ?? 'deal'}`,
      })
      toast.success('Deal executed')
      setExecutedMove(null)
    } catch {
      toast.error('Could not execute the deal')
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
            <button
              type="button"
              onClick={() =>
                tenantRep.company ? setCompanyEditOpen(true) : setContactEditOpen(true)
              }
              className="group flex items-center gap-1.5 text-left text-xl font-semibold hover:underline"
              title="Rename"
            >
              {title}
              <Pencil className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            {tenantRep.company && tenantRep.contact && (
              <p className="text-sm text-muted-foreground">{contactNameOf(tenantRep.contact)}</p>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <Plus className="size-4" />
              Add property
              <ChevronDown className="size-4 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {automationEnabled() && (
              <DropdownMenuItem onSelect={() => setFindOpen(true)}>
                <Search className="size-4" />
                Find listings
              </DropdownMenuItem>
            )}
            {automationEnabled() && (
              <DropdownMenuItem onSelect={() => openAdd('paste')}>
                <ExternalLink className="size-4" />
                Paste listing link
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => openAdd('manual')}>
              <Plus className="size-4" />
              Add manually
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
              <Button onClick={() => openAdd('manual')}>
                <Plus className="size-4" />
                Add property
              </Button>
            </div>
          ) : (
            <div className="flex items-stretch gap-3">
              <PassedRail
                items={passed.map((m) => ({
                  id: m.id,
                  title: m.property?.address ?? 'Property',
                  subtitle:
                    [m.property?.city, m.property?.state].filter(Boolean).join(', ') || null,
                }))}
                onRestore={restorePassed}
                onDelete={deletePassed}
                deletePending={deleteMatch.isPending}
              />
              <div className="min-w-0 flex-1">
                <KanbanBoard
                  columns={tenantBoardStages(tenantRep.deal_type)}
                  items={matches}
                  getId={(m) => m.id}
                  getStage={(m) => m.stage}
                  onMove={handleMove}
                  renderCard={(m) => (
                    <MatchCard
                      match={m}
                      facing="tenant"
                      onPreview={() => setPreviewPropertyId(m.property_id)}
                      onOpen={() => navigate(`/properties/${m.property_id}`)}
                      onRemove={() => softPass(m)}
                    />
                  )}
                />
              </div>
            </div>
          )}
        </div>

        <aside className="order-2 w-full lg:order-1 lg:w-auto lg:shrink-0">
          <BoardInfoPanel
            entityType="client"
            entityId={tenantRep.id}
            fileCategory="rep_agreement"
            collapsed={infoCollapsed}
            onToggle={toggleInfo}
          >
            <DealTasks parentType="client" parentId={tenantRep.id} />

            {(tenantRep.status === 'closed' || tenantRep.actual_fee != null) && (
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
                {executedPursuit && (
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={executedPursuit.payment_received}
                      onCheckedChange={(v) => {
                        const received = v === true
                        paymentToggle.mutate(
                          {
                            pursuitId: executedPursuit.id,
                            received,
                            ownerId: executedPursuit.owner_id,
                            title: `Payment received? — ${executedPursuit.property?.address ?? 'deal'}`,
                          },
                          {
                            onSuccess: (rung) =>
                              toast.success(
                                received ? 'Payment marked received' : paymentRungMessage(rung),
                              ),
                            onError: () => toast.error('Could not update payment'),
                          },
                        )
                      }}
                    />
                    Payment received
                    {!executedPursuit.payment_received && (
                      <span className="text-xs text-muted-foreground">· reminders active</span>
                    )}
                  </label>
                )}
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
                    {tenantRep.company.industry && (
                      <div className="text-xs text-muted-foreground">
                        {tenantRep.company.industry}
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
              <NotesLog parentType="client" parentId={tenantRep.id} showComposer={false} />
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

      <AddPropertyMatchDialog open={addOpen} onOpenChange={setAddOpen} tenantRep={tenantRep} initialMode={addMode} />
      <FindListingsDialog open={findOpen} onOpenChange={setFindOpen} tenantRep={tenantRep} />
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
        dealType={tenantRep.deal_type}
        commissionCalcContext={{
          commissionPct: tenantRep.commission_pct,
          coBrokeSplitPct: null,
          buildingSf: executedMove?.match.property?.building_sf ?? null,
        }}
        pending={executePursuit.isPending}
        onConfirm={confirmExecuted}
      />
    </div>
  )
}
