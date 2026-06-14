import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Columns3,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Table as TableIcon,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AddListingDialog } from '@/components/add-listing-dialog'
import { AddTenantDialog } from '@/components/add-tenant-dialog'
import { KanbanBoard } from '@/components/kanban/kanban-board'
import { ListingCard } from '@/components/listing-card'
import { ListErrorState } from '@/components/list-error-state'
import { MarkLostDialog } from '@/components/mark-lost-dialog'
import { SourceBadge } from '@/components/source-badge'
import { TenantRepCard, sizeSummary } from '@/components/tenant-rep-card'
import {
  useListings,
  useMarkListingLost,
  useReopenListing,
  useUpdateListingStage,
} from '@/hooks/use-listings'
import type { ListingWithRelations } from '@/hooks/use-listings'
import {
  useMarkTenantRepLost,
  useReopenTenantRep,
  useTenantReps,
  useUpdateTenantRepStage,
} from '@/hooks/use-tenant-reps'
import type { TenantRepWithRelations } from '@/hooks/use-tenant-reps'
import { formatListingPrice } from '@/lib/format'
import {
  bucketToTenantRepStage,
  listingStages,
  liveMatches,
  reppingOverviewStages,
  tenantRepStages,
  tenantRepStageToBucket,
  type ReppingBucket,
} from '@/lib/stages'
import type { Enums } from '@/lib/database.types'
import { cn } from '@/lib/utils'

type StatusFilter = 'active' | 'lost' | 'all'
type Side = 'landlord' | 'tenant'

const listingStageLabels = Object.fromEntries(listingStages.map((s) => [s.value, s.label]))
const tenantStageLabels = Object.fromEntries(tenantRepStages.map((s) => [s.value, s.label]))
const bucketLabels = Object.fromEntries(reppingOverviewStages.map((s) => [s.value, s.label]))

function tenantName(t: TenantRepWithRelations): string {
  if (t.company?.name) return t.company.name
  if (t.contact) {
    const name = [t.contact.first_name, t.contact.last_name].filter(Boolean).join(' ')
    if (name) return name
  }
  return 'Untitled tenant'
}

/** Row actions menu for the table view — carries the Mark lost / Reopen affordance that
 *  used to live only on board cards. */
function RowActions({
  status,
  onMarkLost,
  onReopen,
  label,
}: {
  status: 'active' | 'lost'
  onMarkLost: () => void
  onReopen: () => void
  label: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7">
          <MoreHorizontal className="size-4" />
          <span className="sr-only">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {status === 'active' ? (
          <DropdownMenuItem variant="destructive" onSelect={onMarkLost}>
            <XCircle className="size-4" />
            Mark lost
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onReopen}>
            <RotateCcw className="size-4" />
            Reopen
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ReppingPage() {
  const navigate = useNavigate()
  const [side, setSide] = useState<Side>('landlord')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [view, setView] = useState<'board' | 'table'>('board')
  const [addListingOpen, setAddListingOpen] = useState(false)
  const [addTenantOpen, setAddTenantOpen] = useState(false)
  const [losingListing, setLosingListing] = useState<ListingWithRelations | null>(null)
  const [losingTenant, setLosingTenant] = useState<TenantRepWithRelations | null>(null)

  const listingsQ = useListings()
  const tenantsQ = useTenantReps()
  const updateListingStage = useUpdateListingStage()
  const updateTenantStage = useUpdateTenantRepStage()
  const markListingLost = useMarkListingLost()
  const markTenantLost = useMarkTenantRepLost()
  const reopenListing = useReopenListing()
  const reopenTenant = useReopenTenantRep()

  const filteredListings = useMemo(
    () => (listingsQ.data ?? []).filter((l) => (status === 'all' ? true : l.status === status)),
    [listingsQ.data, status],
  )
  const filteredTenants = useMemo(
    () => (tenantsQ.data ?? []).filter((t) => (status === 'all' ? true : t.status === status)),
    [tenantsQ.data, status],
  )

  const handleListingMove = (listing: ListingWithRelations, toStage: Enums<'listing_stage'>) => {
    const fromStage = listing.stage
    if (fromStage === toStage) return
    updateListingStage.mutate(
      { id: listing.id, stage: toStage },
      {
        onSuccess: () => {
          toast.success(`Moved to ${listingStageLabels[toStage]}`, {
            action: {
              label: 'Undo',
              onClick: () => updateListingStage.mutate({ id: listing.id, stage: fromStage }),
            },
          })
        },
        onError: () => toast.error('Could not move listing'),
      },
    )
  }

  const handleTenantMove = (tenantRep: TenantRepWithRelations, toBucket: ReppingBucket) => {
    const fromStage = tenantRep.stage
    const target = bucketToTenantRepStage(toBucket)
    if (fromStage === target) return
    updateTenantStage.mutate(
      { id: tenantRep.id, stage: target },
      {
        onSuccess: () => {
          toast.success(`Moved to ${bucketLabels[toBucket]}`, {
            action: {
              label: 'Undo',
              onClick: () => updateTenantStage.mutate({ id: tenantRep.id, stage: fromStage }),
            },
          })
        },
        onError: () => toast.error('Could not move tenant'),
      },
    )
  }

  const confirmListingLost = (lostReason: string | null, alsoMarkMatchesDead: boolean) => {
    if (!losingListing) return
    markListingLost.mutate(
      { id: losingListing.id, lostReason, markMatchesDead: alsoMarkMatchesDead },
      {
        onSuccess: () => {
          toast.success('Listing marked lost')
          setLosingListing(null)
        },
        onError: () => toast.error('Could not mark listing lost'),
      },
    )
  }

  const confirmTenantLost = (lostReason: string | null, alsoMarkMatchesDead: boolean) => {
    if (!losingTenant) return
    markTenantLost.mutate(
      { id: losingTenant.id, lostReason, markMatchesDead: alsoMarkMatchesDead },
      {
        onSuccess: () => {
          toast.success('Tenant marked lost')
          setLosingTenant(null)
        },
        onError: () => toast.error('Could not mark tenant lost'),
      },
    )
  }

  const handleReopenListing = (listing: ListingWithRelations) => {
    reopenListing.mutate(listing.id, {
      onSuccess: () => toast.success('Listing reopened'),
      onError: () => toast.error('Could not reopen listing'),
    })
  }

  const handleReopenTenant = (tenantRep: TenantRepWithRelations) => {
    reopenTenant.mutate(tenantRep.id, {
      onSuccess: () => toast.success('Tenant reopened'),
      onError: () => toast.error('Could not reopen tenant'),
    })
  }

  const isLandlord = side === 'landlord'
  const active = isLandlord ? listingsQ : tenantsQ
  const { isLoading, isError, refetch } = active
  const itemCount = isLandlord ? filteredListings.length : filteredTenants.length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Repping</h1>
        {isLandlord ? (
          <Button onClick={() => setAddListingOpen(true)}>
            <Plus className="size-4" />
            Add property
          </Button>
        ) : (
          <Button onClick={() => setAddTenantOpen(true)}>
            <Plus className="size-4" />
            Add tenant
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={side} onValueChange={(v) => setSide(v as Side)}>
          <TabsList>
            <TabsTrigger value="landlord">Landlord repping</TabsTrigger>
            <TabsTrigger value="tenant">Tenant repping</TabsTrigger>
          </TabsList>
        </Tabs>

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
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-64 w-72" />
          ))}
        </div>
      ) : isError ? (
        <ListErrorState
          message={isLandlord ? 'Could not load listings.' : 'Could not load tenant reps.'}
          onRetry={() => refetch()}
        />
      ) : itemCount === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {status === 'lost'
              ? isLandlord
                ? 'No lost listings here.'
                : 'No lost tenant reps here.'
              : isLandlord
                ? 'No listings yet — add a property to start.'
                : 'No tenant reps yet — add a tenant to start.'}
          </p>
          {status !== 'lost' &&
            (isLandlord ? (
              <Button onClick={() => setAddListingOpen(true)}>
                <Plus className="size-4" />
                Add property
              </Button>
            ) : (
              <Button onClick={() => setAddTenantOpen(true)}>
                <Plus className="size-4" />
                Add tenant
              </Button>
            ))}
        </div>
      ) : view === 'board' ? (
        isLandlord ? (
          <KanbanBoard
            columns={listingStages}
            items={filteredListings}
            getId={(l) => l.id}
            getStage={(l) => l.stage}
            onMove={handleListingMove}
            renderCard={(l) => (
              <ListingCard
                listing={l}
                onOpen={() => navigate(`/landlord-rep/${l.id}`)}
                onMarkLost={setLosingListing}
                onReopen={handleReopenListing}
              />
            )}
          />
        ) : (
          <KanbanBoard
            columns={reppingOverviewStages}
            items={filteredTenants}
            getId={(t) => t.id}
            getStage={(t) => tenantRepStageToBucket(t.stage)}
            onMove={handleTenantMove}
            renderCard={(t) => (
              <TenantRepCard
                tenantRep={t}
                onOpen={() => navigate(`/tenant-rep/${t.id}`)}
                onMarkLost={setLosingTenant}
                onReopen={handleReopenTenant}
              />
            )}
          />
        )
      ) : isLandlord ? (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Landlord</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Prospects</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredListings.map((l) => (
                <TableRow
                  key={l.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/landlord-rep/${l.id}`)}
                >
                  <TableCell className="font-medium">{l.property?.address}</TableCell>
                  <TableCell className="text-muted-foreground">{l.landlord?.name}</TableCell>
                  <TableCell>{listingStageLabels[l.stage]}</TableCell>
                  <TableCell className="tabular-nums">{formatListingPrice(l)}</TableCell>
                  <TableCell>{liveMatches(l.matches).length}</TableCell>
                  <TableCell>
                    <SourceBadge source={l.source} />
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'text-xs',
                        l.status === 'lost' ? 'text-red-600' : 'text-muted-foreground',
                      )}
                    >
                      {l.status === 'lost' ? 'Lost' : 'Active'}
                    </span>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <RowActions
                      status={l.status}
                      onMarkLost={() => setLosingListing(l)}
                      onReopen={() => handleReopenListing(l)}
                      label="Listing actions"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTenants.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/tenant-rep/${t.id}`)}
                >
                  <TableCell className="font-medium">{tenantName(t)}</TableCell>
                  <TableCell>{tenantStageLabels[t.stage]}</TableCell>
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
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <RowActions
                      status={t.status}
                      onMarkLost={() => setLosingTenant(t)}
                      onReopen={() => handleReopenTenant(t)}
                      label="Tenant actions"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddListingDialog
        open={addListingOpen}
        onOpenChange={setAddListingOpen}
        defaultDealType="lease"
      />
      <AddTenantDialog open={addTenantOpen} onOpenChange={setAddTenantOpen} />

      <MarkLostDialog
        open={!!losingListing}
        onOpenChange={(open) => !open && setLosingListing(null)}
        title={`Mark “${losingListing?.property?.address ?? 'listing'}” lost?`}
        openMatchCount={losingListing ? liveMatches(losingListing.matches).length : 0}
        pending={markListingLost.isPending}
        onConfirm={confirmListingLost}
      />
      <MarkLostDialog
        open={!!losingTenant}
        onOpenChange={(open) => !open && setLosingTenant(null)}
        title={`Mark “${losingTenant ? tenantName(losingTenant) : 'tenant'}” lost?`}
        openMatchCount={losingTenant ? liveMatches(losingTenant.matches).length : 0}
        pending={markTenantLost.isPending}
        onConfirm={confirmTenantLost}
      />
    </div>
  )
}
