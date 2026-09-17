import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import {
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  ListTodo,
  PhoneCall,
  Plus,
  Table2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AddProspectDialog } from '@/components/add-prospect-dialog'
import { KanbanBoard } from '@/components/kanban/kanban-board'
import { ListErrorState } from '@/components/list-error-state'
import { ProspectSlideOver } from '@/components/prospect-slide-over'
import { contactNameOf } from '@/hooks/use-contacts'
import {
  useLeadBoard,
  useSetLeadStage,
  useSetLeadTemperature,
  type LeadBoardRow,
  type LeadStage,
} from '@/hooks/use-lead-board'
import { useProspects, type ProspectWithRelations } from '@/hooks/use-prospects'
import { useTasks } from '@/hooks/use-tasks'
import { formatDate, isOverdue } from '@/lib/dates'
import {
  TEMPERATURE_META,
  activityOf,
  calledOf,
  leadKindOf,
  leadSourceOf,
  meetingTypeMeta,
  temperatureRank,
  type Temperature,
} from '@/lib/lead-source'
import type { StageDef } from '@/lib/stages'
import { cn } from '@/lib/utils'

/**
 * Leads — every inquiry from the website, the VA and GHL, before it is a deal.
 * Deep link: `/prospecting?prospect=<id>` opens that lead (task rows and Slack posts use it).
 *
 * New / Booked / Prep / Met are derived in Postgres from the meeting date, so they keep
 * themselves honest and are never dragged. Reschedule / Client / Unqualified are the only
 * decisions. Dead and Unqualified sit at the two ends as narrow strips you click open.
 */

const BOARD_STAGES: StageDef<LeadStage>[] = [
  { value: 'dead', label: 'Dead' },
  { value: 'new', label: 'New' },
  { value: 'booked', label: 'Booked' },
  { value: 'prep', label: 'Prep' },
  { value: 'met', label: 'Met' },
  { value: 'reschedule', label: 'Reschedule' },
  { value: 'client', label: 'Client' },
  { value: 'unqualified', label: 'Unqualified' },
]

/** Parked outside the flow: a narrow strip until you click it open. */
const PARKED: LeadStage[] = ['dead', 'unqualified']

/** Columns where a temperature is worth having: you have spoken to them. */
const RATEABLE: LeadStage[] = ['met', 'reschedule', 'client']

type Lead = ProspectWithRelations & { board: LeadBoardRow }

type ViewMode = 'board' | 'table' | 'calendar'

function meetingLabel(at: string | null): string | null {
  if (!at) return null
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? null : format(d, 'EEE MMM d · h:mm a')
}

function TemperaturePicker({
  value,
  onPick,
}: {
  value: string | null
  onPick: (t: Temperature | null) => void
}) {
  return (
    <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
      {(Object.keys(TEMPERATURE_META) as Temperature[]).map((t) => {
        const on = value === t
        return (
          <button
            key={t}
            type="button"
            title={TEMPERATURE_META[t].label}
            aria-label={TEMPERATURE_META[t].label}
            aria-pressed={on}
            onClick={(e) => {
              e.stopPropagation()
              onPick(on ? null : t)
            }}
            className={cn(
              'size-3.5 rounded-full border transition-transform hover:scale-125',
              on ? TEMPERATURE_META[t].chip : 'bg-transparent',
              on ? 'border-transparent' : 'border-muted-foreground/40',
            )}
          />
        )
      })}
    </div>
  )
}

function LeadCard({
  lead,
  tasks,
  onOpen,
  onTemperature,
  showTemperature,
}: {
  lead: Lead
  tasks?: { open: number; overdue: boolean }
  onOpen: () => void
  onTemperature: (t: Temperature | null) => void
  showTemperature: boolean
}) {
  const who = lead.contact ? contactNameOf(lead.contact) : (lead.company?.name ?? 'Lead')
  const kind = leadKindOf(lead)
  const src = leadSourceOf(lead)
  const called = calledOf(lead)
  const activity = activityOf(lead)
  const mt = meetingTypeMeta(lead.board.meeting_type)
  const when = meetingLabel(lead.board.meeting_at)
  const temp = lead.board.temperature
  const edge = temp && temp in TEMPERATURE_META ? TEMPERATURE_META[temp as Temperature].edge : null

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'cursor-pointer rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40',
        edge && `border-l-4 ${edge}`,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {tasks?.overdue && (
              <span className="size-2 shrink-0 rounded-full bg-red-500" title="Task overdue" />
            )}
            {lead.contact ? (
              <Link
                to={`/contacts/${lead.contact.id}`}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="truncate text-sm font-medium hover:underline"
                title="Open contact"
              >
                {who}
              </Link>
            ) : (
              <span className="truncate text-sm font-medium">{who}</span>
            )}
          </div>
          {lead.company?.name && lead.contact && (
            <div className="truncate text-xs text-muted-foreground">{lead.company.name}</div>
          )}
        </div>
        {showTemperature && (
          <TemperaturePicker value={temp} onPick={onTemperature} />
        )}
      </div>

      {when && (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          {mt && <span className={cn('size-2 shrink-0 rounded-full', mt.dot)} />}
          <span className="truncate font-medium text-foreground">{when}</span>
        </div>
      )}

      {lead.description && !when && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{lead.description}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {mt ? (
          <Badge variant="outline" className={cn('font-medium', mt.className)}>
            {mt.label}
          </Badge>
        ) : (
          kind && (
            <Badge variant="outline" className={cn('font-medium', kind.className)}>
              {kind.label}
            </Badge>
          )
        )}
        {lead.board.qualified === false && (
          <Badge variant="outline" className="border-gray-200 bg-gray-50 font-normal text-gray-600">
            Not qualified
          </Badge>
        )}
        {src && (
          <Badge variant="outline" className={cn('font-normal', src.className)}>
            {src.label}
          </Badge>
        )}
        {called && (
          <Badge
            variant="outline"
            className="gap-1 border-violet-200 bg-violet-50 font-normal text-violet-700"
          >
            <PhoneCall className="size-3" />
            {called.label}
          </Badge>
        )}
        {activity.map((a) => (
          <Badge key={a.key} variant="outline" className={cn('font-normal', a.className)}>
            {a.label}
          </Badge>
        ))}
        {lead.properties.length > 0 && (
          <Badge variant="secondary" className="gap-1 font-normal">
            <Building2 className="size-3" />
            {lead.properties.length === 1
              ? (lead.properties[0].property?.address ?? '1 property')
              : `${lead.properties.length} properties`}
          </Badge>
        )}
        {tasks && tasks.open > 0 && (
          <Badge variant="outline" className="gap-1 font-normal">
            <ListTodo className="size-3" />
            {tasks.open} {tasks.open === 1 ? 'task' : 'tasks'}
          </Badge>
        )}
      </div>
    </div>
  )
}

function CalendarView({ leads, onOpen }: { leads: Lead[]; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month)),
        end: endOfWeek(endOfMonth(month)),
      }),
    [month],
  )
  const byDay = useMemo(() => {
    const m = new Map<string, Lead[]>()
    for (const l of leads) {
      if (!l.board.meeting_at) continue
      const d = new Date(l.board.meeting_at)
      if (Number.isNaN(d.getTime())) continue
      const key = format(d, 'yyyy-MM-dd')
      m.set(key, [...(m.get(key) ?? []), l])
    }
    for (const list of m.values()) {
      list.sort(
        (a, b) => new Date(a.board.meeting_at!).getTime() - new Date(b.board.meeting_at!).getTime(),
      )
    }
    return m
  }, [leads])

  const today = new Date()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setMonth(subMonths(month, 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-2 text-sm font-medium">{format(month, 'MMMM yyyy')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {(['space', 'software', 'consultation'] as const).map((t) => {
            const meta = meetingTypeMeta(t)!
            return (
              <span key={t} className="flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full', meta.dot)} />
                {meta.label}
              </span>
            )
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd')
            const items = byDay.get(key) ?? []
            return (
              <div
                key={key}
                className={cn(
                  'min-h-24 border-b border-r p-1 last:border-r-0',
                  !isSameMonth(day, month) && 'bg-muted/30',
                )}
              >
                <div
                  className={cn(
                    'mb-1 px-1 text-xs',
                    isSameDay(day, today)
                      ? 'font-semibold text-primary'
                      : isSameMonth(day, month)
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/50',
                  )}
                >
                  {format(day, 'd')}
                </div>
                <div className="space-y-1">
                  {items.map((l) => {
                    const meta = meetingTypeMeta(l.board.meeting_type)
                    const who = l.contact ? contactNameOf(l.contact) : (l.company?.name ?? 'Lead')
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => onOpen(l.id)}
                        title={`${who} — ${meetingLabel(l.board.meeting_at) ?? ''}`}
                        className={cn(
                          'block w-full truncate rounded border px-1.5 py-1 text-left text-[11px] leading-tight hover:brightness-95',
                          meta?.className ?? 'border-slate-200 bg-slate-50 text-slate-700',
                        )}
                      >
                        {format(new Date(l.board.meeting_at!), 'h:mm a')} {who}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function ProspectingPage() {
  const { data: prospects = [], isLoading, isError, refetch } = useProspects(true)
  const { data: board = [], isLoading: boardLoading } = useLeadBoard()
  const { data: allTasks = [] } = useTasks()
  const setStage = useSetLeadStage()
  const setTemperature = useSetLeadTemperature()
  const [addOpen, setAddOpen] = useState(false)
  const [view, setView] = useState<ViewMode>('board')
  const [params] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(params.get('prospect'))

  const taskCounts = useMemo(() => {
    const m = new Map<string, { open: number; overdue: boolean }>()
    for (const t of allTasks) {
      if (!t.prospect_id || t.status !== 'open') continue
      const cur = m.get(t.prospect_id) ?? { open: 0, overdue: false }
      cur.open += 1
      if (isOverdue(t.due_date)) cur.overdue = true
      m.set(t.prospect_id, cur)
    }
    return m
  }, [allTasks])

  /** The board view decides who is on the board at all; it already drops dead leads. */
  const leads = useMemo<Lead[]>(() => {
    const placement = new Map(board.map((b) => [b.prospect_id, b]))
    return prospects
      .map((p) => {
        const b = placement.get(p.id)
        return b ? ({ ...p, board: b } as Lead) : null
      })
      .filter((l): l is Lead => l !== null)
      .sort((a, b) => {
        const t = temperatureRank(a.board.temperature) - temperatureRank(b.board.temperature)
        if (t !== 0) return t
        const am = a.board.meeting_at ? new Date(a.board.meeting_at).getTime() : Infinity
        const bm = b.board.meeting_at ? new Date(b.board.meeting_at).getTime() : Infinity
        if (am !== bm) return am - bm
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
  }, [prospects, board])

  const withMeetings = useMemo(() => leads.filter((l) => l.board.meeting_at), [leads])

  const renderCard = (lead: Lead) => (
    <LeadCard
      lead={lead}
      tasks={taskCounts.get(lead.id)}
      onOpen={() => setSelectedId(lead.id)}
      showTemperature={RATEABLE.includes(lead.board.stage as LeadStage)}
      onTemperature={(t) => setTemperature.mutate({ id: lead.id, temperature: t })}
    />
  )

  const selected: ProspectWithRelations | null = prospects.find((p) => p.id === selectedId) ?? null
  const loading = isLoading || boardLoading

  const viewButton = (mode: ViewMode, label: string, Icon: typeof Columns3) => (
    <Button
      key={mode}
      variant={view === mode ? 'secondary' : 'ghost'}
      size="sm"
      onClick={() => setView(mode)}
      className="gap-1.5"
    >
      <Icon className="size-4" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Leads</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-md border p-0.5">
            {viewButton('board', 'Board', Columns3)}
            {viewButton('table', 'Table', Table2)}
            {viewButton('calendar', 'Calendar', CalendarDays)}
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add prospect</span>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ListErrorState message="Could not load leads." onRetry={() => refetch()} />
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            No leads yet. Capture a lead here — a person, the properties in play, and your
            notes — then push it to landlord or tenant rep when it's real.
          </p>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add prospect
          </Button>
        </div>
      ) : view === 'calendar' ? (
        <CalendarView leads={withMeetings} onOpen={setSelectedId} />
      ) : view === 'table' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {leads.map((lead) => (
            <div key={lead.id}>
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                {BOARD_STAGES.find((s) => s.value === lead.board.stage)?.label ?? 'Unqualified'}
                <span className="ml-2 normal-case">{formatDate(lead.created_at)}</span>
              </div>
              {renderCard(lead)}
            </div>
          ))}
        </div>
      ) : (
        <KanbanBoard
          columns={BOARD_STAGES}
          items={leads}
          getId={(l) => l.id}
          getStage={(l) => l.board.stage as LeadStage}
          onMove={(l, toStage) =>
            setStage.mutate({
              id: l.id,
              stage: toStage,
              fromDead: l.board.stage === 'dead',
            })
          }
          renderCard={renderCard}
          collapsibleStages={PARKED}
        />

      )}

      <AddProspectDialog open={addOpen} onOpenChange={setAddOpen} />
      <ProspectSlideOver
        prospect={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  )
}
