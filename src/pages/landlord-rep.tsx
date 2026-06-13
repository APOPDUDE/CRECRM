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
import { KanbanBoard } from '@/components/kanban/kanban-board'
import { ListingCard } from '@/components/listing-card'
import { ListErrorState } from '@/components/list-error-state'
import { MarkLostDialog } from '@/components/mark-lost-dialog'
import { SourceBadge } from '@/components/source-badge'
import {
  useListings,
  useMarkListingLost,
  useReopenListing,
  useUpdateListingStage,
} from '@/hooks/use-listings'
import type { ListingWithRelations } from '@/hooks/use-listings'
import type { Enums } from '@/lib/database.types'
import { formatListingPrice } from '@/lib/format'
import { listingStages, liveMatches } from '@/lib/stages'
import { cn } from '@/lib/utils'

type StatusFilter = 'active' | 'lost' | 'all'
const stageLabels = Object.fromEntries(listingStages.map((s) => [s.value, s.label]))

export function LandlordRepPage() {
  const navigate = useNavigate()
  const { data: listings, isLoading, isError, refetch } = useListings()
  const updateStage = useUpdateListingStage()
  const markLost = useMarkListingLost()
  const reopen = useReopenListing()

  const [dealType, setDealType] = useState<Enums<'deal_type'>>('lease')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [view, setView] = useState<'board' | 'table'>('board')
  const [addOpen, setAddOpen] = useState(false)
  const [losing, setLosing] = useState<ListingWithRelations | null>(null)

  const filtered = useMemo(() => {
    return (listings ?? []).filter((l) => {
      if (l.deal_type !== dealType) return false
      if (status === 'active') return l.status === 'active'
      if (status === 'lost') return l.status === 'lost'
      return true
    })
  }, [listings, dealType, status])

  const handleMove = (listing: ListingWithRelations, toStage: string) => {
    const fromStage = listing.stage
    updateStage.mutate(
      { id: listing.id, stage: toStage as Enums<'listing_stage'> },
      {
        onSuccess: () => {
          toast.success(`Moved to ${stageLabels[toStage]}`, {
            action: {
              label: 'Undo',
              onClick: () => updateStage.mutate({ id: listing.id, stage: fromStage }),
            },
          })
        },
        onError: () => toast.error('Could not move listing'),
      },
    )
  }

  const confirmLost = (lostReason: string | null, alsoMarkMatchesDead: boolean) => {
    if (!losing) return
    markLost.mutate(
      { id: losing.id, lostReason, markMatchesDead: alsoMarkMatchesDead },
      {
        onSuccess: () => {
          toast.success('Listing marked lost')
          setLosing(null)
        },
        onError: () => toast.error('Could not mark listing lost'),
      },
    )
  }

  const handleReopen = (listing: ListingWithRelations) => {
    reopen.mutate(listing.id, {
      onSuccess: () => toast.success('Listing reopened'),
      onError: () => toast.error('Could not reopen listing'),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Landlord Rep</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add property
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={dealType} onValueChange={(v) => setDealType(v as Enums<'deal_type'>)}>
          <TabsList>
            <TabsTrigger value="lease">For lease</TabsTrigger>
            <TabsTrigger value="sale">For sale</TabsTrigger>
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
        <ListErrorState message="Could not load listings." onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {status === 'lost'
              ? 'No lost listings here.'
              : `No ${dealType === 'lease' ? 'for-lease' : 'for-sale'} listings yet — add a property to start.`}
          </p>
          {status !== 'lost' && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add property
            </Button>
          )}
        </div>
      ) : view === 'board' ? (
        <KanbanBoard
          columns={listingStages}
          items={filtered}
          getId={(l) => l.id}
          getStage={(l) => l.stage}
          onMove={handleMove}
          renderCard={(l) => (
            <ListingCard
              listing={l}
              onOpen={() => navigate(`/landlord-rep/${l.id}`)}
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
                <TableHead>Property</TableHead>
                <TableHead>Landlord</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Prospects</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.property?.address}</TableCell>
                  <TableCell className="text-muted-foreground">{l.landlord?.name}</TableCell>
                  <TableCell>{stageLabels[l.stage]}</TableCell>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddListingDialog open={addOpen} onOpenChange={setAddOpen} defaultDealType={dealType} />
      <MarkLostDialog
        open={!!losing}
        onOpenChange={(open) => !open && setLosing(null)}
        title={`Mark “${losing?.property?.address ?? 'listing'}” lost?`}
        openMatchCount={losing ? liveMatches(losing.matches).length : 0}
        pending={markLost.isPending}
        onConfirm={confirmLost}
      />
    </div>
  )
}
