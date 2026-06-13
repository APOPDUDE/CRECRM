import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Columns3, Plus, Table as TableIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AddTenantDialog } from '@/components/add-tenant-dialog'
import { KanbanBoard } from '@/components/kanban/kanban-board'
import { ListErrorState } from '@/components/list-error-state'
import { MarkLostDialog } from '@/components/mark-lost-dialog'
import { SourceBadge } from '@/components/source-badge'
import { TenantRepCard, sizeSummary } from '@/components/tenant-rep-card'
import {
  useMarkTenantRepLost,
  useReopenTenantRep,
  useTenantReps,
  useUpdateTenantRepStage,
} from '@/hooks/use-tenant-reps'
import type { TenantRepWithRelations } from '@/hooks/use-tenant-reps'
import type { Enums } from '@/lib/database.types'
import { tenantRepStages, liveMatches } from '@/lib/stages'
import { cn } from '@/lib/utils'

type StatusFilter = 'active' | 'lost' | 'all'
const stageLabels = Object.fromEntries(tenantRepStages.map((s) => [s.value, s.label]))

function tenantName(t: TenantRepWithRelations): string {
  if (t.company?.name) return t.company.name
  if (t.contact) {
    const name = [t.contact.first_name, t.contact.last_name].filter(Boolean).join(' ')
    if (name) return name
  }
  return 'Untitled tenant'
}

export function TenantRepPage() {
  const navigate = useNavigate()
  const { data: tenantReps, isLoading, isError, refetch } = useTenantReps()
  const updateStage = useUpdateTenantRepStage()
  const markLost = useMarkTenantRepLost()
  const reopen = useReopenTenantRep()

  const [status, setStatus] = useState<StatusFilter>('active')
  const [view, setView] = useState<'board' | 'table'>('board')
  const [addOpen, setAddOpen] = useState(false)
  const [losing, setLosing] = useState<TenantRepWithRelations | null>(null)

  const filtered = useMemo(() => {
    return (tenantReps ?? []).filter((t) => {
      if (status === 'active') return t.status === 'active'
      if (status === 'lost') return t.status === 'lost'
      return true
    })
  }, [tenantReps, status])

  const handleMove = (tenantRep: TenantRepWithRelations, toStage: string) => {
    const fromStage = tenantRep.stage
    updateStage.mutate(
      { id: tenantRep.id, stage: toStage as Enums<'tenant_rep_stage'> },
      {
        onSuccess: () => {
          toast.success(`Moved to ${stageLabels[toStage]}`, {
            action: {
              label: 'Undo',
              onClick: () => updateStage.mutate({ id: tenantRep.id, stage: fromStage }),
            },
          })
        },
        onError: () => toast.error('Could not move tenant'),
      },
    )
  }

  const confirmLost = (lostReason: string | null, alsoMarkMatchesDead: boolean) => {
    if (!losing) return
    markLost.mutate(
      { id: losing.id, lostReason, markMatchesDead: alsoMarkMatchesDead },
      {
        onSuccess: () => {
          toast.success('Tenant marked lost')
          setLosing(null)
        },
        onError: () => toast.error('Could not mark tenant lost'),
      },
    )
  }

  const handleReopen = (tenantRep: TenantRepWithRelations) => {
    reopen.mutate(tenantRep.id, {
      onSuccess: () => toast.success('Tenant reopened'),
      onError: () => toast.error('Could not reopen tenant'),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Tenant Rep</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add tenant
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="w-32" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex rounded-md border p-0.5">
            <Button
              variant={view === 'board' ? 'secondary' : 'ghost'}
              size="icon"
              className="size-7"
              onClick={() => setView('board')}
            >
              <Columns3 className="size-4" />
              <span className="sr-only">Board view</span>
            </Button>
            <Button
              variant={view === 'table' ? 'secondary' : 'ghost'}
              size="icon"
              className="size-7"
              onClick={() => setView('table')}
            >
              <TableIcon className="size-4" />
              <span className="sr-only">Table view</span>
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex gap-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-64 w-72" />
          ))}
        </div>
      ) : isError ? (
        <ListErrorState message="Could not load tenant reps." onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {status === 'lost'
              ? 'No lost tenant reps here.'
              : 'No tenant reps yet — add a tenant to start.'}
          </p>
          {status !== 'lost' && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add tenant
            </Button>
          )}
        </div>
      ) : view === 'board' ? (
        <KanbanBoard
          columns={tenantRepStages}
          items={filtered}
          getId={(t) => t.id}
          getStage={(t) => t.stage}
          onMove={handleMove}
          renderCard={(t) => (
            <TenantRepCard
              tenantRep={t}
              onOpen={() => navigate(`/tenant-rep/${t.id}`)}
              onMarkLost={setLosing}
              onReopen={handleReopen}
            />
          )}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>In play</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{tenantName(t)}</TableCell>
                  <TableCell>{stageLabels[t.stage]}</TableCell>
                  <TableCell className="text-muted-foreground">{sizeSummary(t) ?? '—'}</TableCell>
                  <TableCell>{liveMatches(t.matches).length}</TableCell>
                  <TableCell>
                    <SourceBadge source={t.source} />
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'text-xs',
                        t.status === 'lost' ? 'text-red-600' : 'text-muted-foreground',
                      )}
                    >
                      {t.status === 'lost' ? 'Lost' : 'Active'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddTenantDialog open={addOpen} onOpenChange={setAddOpen} />
      <MarkLostDialog
        open={!!losing}
        onOpenChange={(open) => !open && setLosing(null)}
        title={`Mark “${losing ? tenantName(losing) : 'tenant'}” lost?`}
        openMatchCount={losing ? liveMatches(losing.matches).length : 0}
        pending={markLost.isPending}
        onConfirm={confirmLost}
      />
    </div>
  )
}
