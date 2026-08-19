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
import { TaskFocusBanner } from '@/components/task-focus-banner'
import { NotesLog } from '@/components/notes-log'
import { ContactActions } from '@/components/contact-actions'
import { SourceBadge } from '@/components/source-badge'
import { TenantRequirements } from '@/components/tenant-requirements'
import { TenantRepEditDialog } from '@/components/tenant-rep-edit-dialog'
import { TenantCommissionDialog } from '@/components/tenant-commission-dialog'
import { ContactFormDialog } from '@/components/contact-form-dialog'
import { CompanyFormDialog } from '@/components/company-form-dialog'
import { PropertyPreview } from '@/components/property-preview'
import { DraftDocDialog } from '@/components/draft-doc-dialog'
import { StageDateDialog } from '@/components/stage-date-dialog'
import type { DatedStage } from '@/components/stage-date-dialog'
import { TourOutcomeDialog, type TourOutcome } from '@/components/tour-outcome-dialog'
import { useCreateTourNote } from '@/hooks/use-notes'
import { contactNameOf, type Contact } from '@/hooks/use-contacts'
import type { Company } from '@/hooks/use-companies'
import {
  tenantRepMatchesKey,
  useDeleteMatch,
  useExecutePursuit,
  useTenantRepMatches,
  useUpdateMatchStage,
  useUpdatePursuitDealSide,
  useReorderPursuit,
  sortOrderBefore,
} from '@/hooks/use-matches'
import { BoardSideToggle, useBoardSide } from '@/components/board-side-toggle'
import { PassedRail } from '@/components/passed-rail'
import { Checkbox } from '@/components/ui/checkbox'
import type { MatchWithRelations } from '@/hooks/use-matches'
import { useTenantRepDetail } from '@/hooks/use-tenant-reps'
import { paymentRungMessage, useCreateTask, usePaymentReceivedToggle } from '@/hooks/use-tasks'
import { useClearFlaggedNew } from '@/hooks/use-automation'
import { formatCurrency } from '@/lib/format'
import { useSetBreadcrumb } from '@/hooks/use-breadcrumb'
import { useBackTo } from '@/hooks/use-back-to'
import type { Enums, TablesUpdate } from '@/lib/database.types'
import { automationEnabled } from '@/lib/n8n'
import { setReppingSide } from '@/lib/repping-side'
import { boardSides, dealSideLabels, pursuitLabelsFor, tenantBoardStages } from '@/lib/stages'

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
  const [draftMatch, setDraftMatch] = useState<MatchWithRelations | null>(null)
  const [dateMove, setDateMove] = useState<{ match: MatchWithRelations; stage: DatedStage } | null>(
    null,
  )
  const [executedMove, setExecutedMove] = useState<PendingMove | null>(null)
  const [outcomeMove, setOutcomeMove] = useState<{
    match: MatchWithRelations
    outcome: TourOutcome
  } | null>(null)
  const createTourNote = useCreateTourNote()
  const [infoCollapsed, toggleInfo] = useInfoPanelCollapsed()

  // A client looking to lease OR buy runs two boards — the pipelines differ (PSA
  // negotiation + Due diligence on the sale side) — so the board flips between them
  // instead of mixing them. One side in play means no toggle and no filtering, so a
  // pursuit sitting on an unexpected side can never hide.
  const sides = boardSides(tenantRep?.deal_type, matches)
  const [side, setSide] = useBoardSide(tenantRepId, sides)
  // A client on the sale board is a buyer; the sidebar should say so.
  const isBuySide = side === 'sale'
  const flipSide = useUpdatePursuitDealSide(tenantRepMatchesKey(tenantRepId ?? ''))
  const reorder = useReorderPursuit(tenantRepMatchesKey(tenantRepId ?? ''))
  const sideMatches = sides.length > 1 ? matches.filter((m) => m.deal_type === side) : matches
  const sideCounts = {
    lease: matches.filter((m) => m.deal_type === 'lease' && m.stage !== 'passed').length,
    sale: matches.filter((m) => m.deal_type === 'sale' && m.stage !== 'passed').length,
  }

  const moveToOtherSide = (m: MatchWithRelations) => {
    const from = m.deal_type === 'sale' ? 'sale' : 'lease'
    const to = from === 'sale' ? 'lease' : 'sale'
    flipSide.mutate(
      { id: m.id, dealType: to },
      {
        onSuccess: () =>
          toast.success(`Moved to ${dealSideLabels[to]}`, {
            action: {
              label: 'Undo',
              onClick: () => flipSide.mutate({ id: m.id, dealType: from }),
            },
          }),
        onError: () => toast.error('Could not move it to the other board'),
      },
    )
  }

  // Removing a property from the board is SOFT: it moves to the Passed rail on the left,
  // where it can be restored — a hard delete only happens from inside the rail.
  const passed = sideMatches.filter((m) => m.stage === 'passed')
  // Goes through the same prompt as a drag onto Passed, so "why did they pass" is asked
  // once, in one place, however the card got there.
  const softPass = (m: MatchWithRelations) => setOutcomeMove({ match: m, outcome: 'passed' })
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

  // Whoever the title names is who it opens. A deal with neither company nor contact has
  // nothing to open, so the title stays plain text rather than a link that goes nowhere.
  const titleHref = tenantRep?.company
    ? `/companies/${tenantRep.company.id}`
    : tenantRep?.contact
      ? `/contacts/${tenantRep.contact.id}`
      : null

  // Only used on a cold deep link, where there is no history to return to. This board serves
  // buyers and tenants alike, so the guess follows the side being shown.
  const goBack = useBackTo(isBuySide ? '/pipelines/buyers' : '/pipelines/tenant')

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
        <Button variant="ghost" size="sm" onClick={goBack}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <p className="text-sm text-muted-foreground">This client could not be found.</p>
      </div>
    )
  }

  const contact = tenantRep.contact
  const brokerName = tenantRep.broker ? contactNameOf(tenantRep.broker) : null

  // Columns follow the side being shown, not the client's overall deal type — that is
  // what gives a "lease or buy" client real PSA negotiation / Due diligence columns.
  const stageLabels = pursuitLabelsFor(side)
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
    } else if (toStage === 'interested') {
      // The two outcome moves ask why; everything else stays a silent drag.
      setOutcomeMove({ match, outcome: 'interested' })
    } else if (toStage === 'passed') {
      setOutcomeMove({ match, outcome: 'passed' })
    } else {
      plainMove(match, toStage)
    }
  }

  /**
   * Record the outcome, then file the reason against the PROPERTY.
   *
   * The note is written even when the reason is blank — a tenant walking a building and
   * passing is worth knowing on its own — and it carries the pursuit id, so the property
   * page can name the deal it came from. A failed note must not strand the card in the
   * old column, so the move is what gets awaited and the note rides after it.
   */
  const confirmOutcome = (reason: string) => {
    if (!outcomeMove) return
    const { match, outcome } = outcomeMove
    const fromStage = match.stage
    updateStage.mutate(
      { id: match.id, stage: outcome },
      {
        onSuccess: () => {
          if (match.property_id) {
            const label = outcome === 'interested' ? 'Interested' : 'Not interested'
            createTourNote.mutate({
              propertyId: match.property_id,
              pursuitId: match.id,
              body: reason ? `${label} — ${reason}` : label,
            })
          }
          toast.success(outcome === 'interested' ? 'Marked interested' : 'Moved to Passed', {
            action: {
              label: 'Undo',
              onClick: () => updateStage.mutate({ id: match.id, stage: fromStage }),
            },
          })
          setOutcomeMove(null)
        },
        onError: () => toast.error('Could not move pursuit'),
      },
    )
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
      <TaskFocusBanner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={goBack}
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back</span>
          </Button>
          <div>
            {/* The title is whoever the deal is with — a company, or the person when there is
                no company. Clicking a name should open them, not a rename box; renaming moved
                to the pencil beside it, which stays visible on touch where there is no hover. */}
            <div className="group flex items-center gap-1.5">
              {titleHref ? (
                <button
                  type="button"
                  onClick={() => navigate(titleHref)}
                  className="text-left text-xl font-semibold hover:underline"
                >
                  {title}
                </button>
              ) : (
                <h1 className="text-xl font-semibold">{title}</h1>
              )}
              <button
                type="button"
                onClick={() =>
                  tenantRep.company ? setCompanyEditOpen(true) : setContactEditOpen(true)
                }
                className="shrink-0 opacity-60 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                title="Rename"
              >
                <Pencil className="size-3.5 text-muted-foreground" />
                <span className="sr-only">Rename</span>
              </button>
            </div>
            {tenantRep.company && tenantRep.contact && (
              <button
                type="button"
                onClick={() => navigate(`/contacts/${tenantRep.contact!.id}`)}
                className="text-sm text-muted-foreground hover:underline"
              >
                {contactNameOf(tenantRep.contact)}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BoardSideToggle sides={sides} value={side} onChange={setSide} counts={sideCounts} />
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
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="order-1 min-w-0 flex-1 lg:order-2">
          {matchesError ? (
            <ListErrorState message="Could not load properties in play." onRetry={() => refetchMatches()} />
          ) : sideMatches.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {sides.length > 1
                  ? `Nothing on the ${dealSideLabels[side].toLowerCase()} board yet — everything in play is on the other one.`
                  : 'No properties in play yet — add a property to start.'}
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
                  toured: !!m.tour_date,
                }))}
                onRestore={restorePassed}
                onDelete={deletePassed}
                deletePending={deleteMatch.isPending}
              />
              <div className="min-w-0 flex-1">
                <KanbanBoard
                  columns={tenantBoardStages(side)}
                  items={sideMatches}
                  getId={(m) => m.id}
                  getStage={(m) => m.stage}
                  onMove={handleMove}
                  onReorder={(m, before) =>
                    reorder.mutate({
                      id: m.id,
                      sortOrder: sortOrderBefore(
                        sideMatches.filter((x) => x.stage === m.stage),
                        m,
                        before,
                      ),
                    })
                  }
                  renderCard={(m) => (
                    <MatchCard
                      match={m}
                      facing="tenant"
                      onPreview={() => setPreviewPropertyId(m.property_id)}
                      onOpen={() => navigate(`/properties/${m.property_id}`)}
                      onRemove={() => softPass(m)}
                      onFlipSide={sides.length > 1 ? () => moveToOtherSide(m) : undefined}
                      onDraftDoc={() => setDraftMatch(m)}
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
              <SidebarSection title={isBuySide ? 'Buyer contact' : 'Tenant contact'}>
                {/* Opens the person, not a rename box. From a deal you want their history —
                    calls, texts, notes, what else they're in — and editing is one button away
                    once you're there. Back lands you on this deal again. */}
                <div className="rounded-lg border bg-card p-3 text-sm">
                  <button
                    type="button"
                    onClick={() => navigate(`/contacts/${contact.id}`)}
                    className="text-left"
                  >
                    <div className="font-medium hover:underline">{contactNameOf(contact)}</div>
                    {contact.title && (
                      <div className="text-xs text-muted-foreground">{contact.title}</div>
                    )}
                  </button>
                  <ContactActions phone={contact.phone} email={contact.email} ghlContactId={contact.ghl_contact_id} />
                </div>
              </SidebarSection>
            )}

            {tenantRep.company && (
              <SidebarSection title={isBuySide ? 'Buyer company' : 'Tenant company'}>
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

      <AddPropertyMatchDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tenantRep={tenantRep}
        initialMode={addMode}
        boardSide={side}
      />
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
      {draftMatch && (
        <DraftDocDialog
          open={!!draftMatch}
          onOpenChange={(open) => !open && setDraftMatch(null)}
          match={draftMatch}
          docType={draftMatch.deal_type === 'sale' ? 'loi' : 'rfp'}
        />
      )}
      <StageDateDialog
        stage={dateMove?.stage ?? null}
        open={!!dateMove}
        onOpenChange={(open) => !open && setDateMove(null)}
        pending={updateStage.isPending}
        onConfirm={confirmDate}
      />
      <TourOutcomeDialog
        outcome={outcomeMove?.outcome ?? null}
        propertyLabel={outcomeMove?.match.property?.address ?? null}
        open={!!outcomeMove}
        onOpenChange={(open) => !open && setOutcomeMove(null)}
        pending={updateStage.isPending}
        onConfirm={confirmOutcome}
      />
      <ExecutedMatchDialog
        open={!!executedMove}
        onOpenChange={(open) => !open && setExecutedMove(null)}
        dealType={executedMove?.match.deal_type ?? side}
        commissionCalcContext={{
          commissionPct: tenantRep.commission_pct,
          coBrokeSplitPct: null,
          buildingSf: executedMove?.match.property?.gross_sf ?? null,
        }}
        pending={executePursuit.isPending}
        onConfirm={confirmExecuted}
      />
    </div>
  )
}
