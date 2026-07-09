import { useMemo, useState } from 'react'
import { Building2, ListTodo, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { AddProspectDialog } from '@/components/add-prospect-dialog'
import { ListErrorState } from '@/components/list-error-state'
import { ProspectSlideOver } from '@/components/prospect-slide-over'
import { contactNameOf } from '@/hooks/use-contacts'
import { useProspects, type ProspectWithRelations } from '@/hooks/use-prospects'
import { useTasks } from '@/hooks/use-tasks'
import { formatDate, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'

const statusBadge: Record<string, string> = {
  converted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  dead: 'border-gray-200 bg-gray-50 text-gray-600',
}

/**
 * Prospecting — raw leads before they're deals. Each card is a contact plus the
 * properties in play; open one to work it, then push it to landlord or tenant rep.
 */
export function ProspectingPage() {
  const [showAll, setShowAll] = useState(false)
  const { data: prospects = [], isLoading, isError, refetch } = useProspects(showAll)
  const { data: allTasks = [] } = useTasks()
  const [addOpen, setAddOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

  const selected: ProspectWithRelations | null =
    prospects.find((p) => p.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Prospecting</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Checkbox checked={showAll} onCheckedChange={(v) => setShowAll(v === true)} />
            Show converted &amp; dead
          </label>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add prospect</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ListErrorState message="Could not load prospects." onRetry={() => refetch()} />
      ) : prospects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            No prospects yet. Capture a lead here — a person, the properties in play, and your
            notes — then push it to landlord or tenant rep when it's real.
          </p>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add prospect
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {prospects.map((p) => {
            const who = p.contact ? contactNameOf(p.contact) : (p.company?.name ?? 'Prospect')
            const t = taskCounts.get(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className="rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {t?.overdue && (
                        <span className="size-2 shrink-0 rounded-full bg-red-500" title="Task overdue" />
                      )}
                      <span className="truncate text-sm font-medium">{who}</span>
                    </div>
                    {p.company?.name && p.contact && (
                      <div className="truncate text-xs text-muted-foreground">{p.company.name}</div>
                    )}
                  </div>
                  {p.status !== 'open' && (
                    <Badge variant="outline" className={cn('shrink-0', statusBadge[p.status])}>
                      {p.status === 'converted' ? 'Converted' : 'Dead'}
                    </Badge>
                  )}
                </div>

                {p.description && (
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {p.properties.length > 0 && (
                    <Badge variant="secondary" className="gap-1 font-normal">
                      <Building2 className="size-3" />
                      {p.properties.length === 1
                        ? (p.properties[0].property?.address ?? '1 property')
                        : `${p.properties.length} properties`}
                    </Badge>
                  )}
                  {t && t.open > 0 && (
                    <Badge variant="outline" className="gap-1 font-normal">
                      <ListTodo className="size-3" />
                      {t.open} {t.open === 1 ? 'task' : 'tasks'}
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(p.created_at)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
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
