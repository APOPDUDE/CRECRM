import { useState } from 'react'
import { useResetOn } from '@/hooks/use-reset-on'
import { ExternalLink, Handshake } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CreateDealDialog } from '@/components/create-deal-dialog'
import { useSetDealRadarIntent, useUpdateDealRadar, type DealRadarRow } from '@/hooks/use-deal-radar'
import {
  type DealRadarIntent,
  formatRadarPrice,
  formatRadarSize,
  INTENT_ORDER,
  intentBadgeClass,
  intentLabels,
  renderMessage,
  statusBadgeClass,
  statusLabels,
  typeBadgeClass,
  typeLabels,
} from '@/lib/deal-radar'
import { openInNewTab } from '@/lib/deal-radar-outreach'
import { cn } from '@/lib/utils'

interface DealRadarDetailProps {
  row: DealRadarRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Per-deal detail, centered for room to read: the paste-ready message, notes, and
 * a "Create deal" action that turns the listing into a real property + prospect.
 * Facebook omits the description from search results, so we point at the listing
 * for the full text rather than storing a fetch of every card.
 */
export function DealRadarDetail({ row, open, onOpenChange }: DealRadarDetailProps) {
  const update = useUpdateDealRadar()
  const setIntent = useSetDealRadarIntent()
  const [notes, setNotes] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  useResetOn([row?.id, row?.notes], () => {
    setNotes(row?.notes ?? '')
  })

  if (!row) return null

  const price = formatRadarPrice(row)
  const size = formatRadarSize(row)
  const dirty = notes !== (row.notes ?? '')

  function save() {
    update.mutate(
      { id: row!.id, notes: notes || null },
      { onSuccess: () => toast('Saved.') },
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="pr-6 text-base leading-snug">{row.title}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={typeBadgeClass[row.listing_type]}>
                {typeLabels[row.listing_type]}
              </Badge>
              <Badge variant="outline" className={intentBadgeClass[row.listing_intent]}>
                {intentLabels[row.listing_intent]}
              </Badge>
              <Badge variant="outline" className={statusBadgeClass[row.status]}>
                {statusLabels[row.status]}
              </Badge>
              <Badge variant="secondary" className="font-normal">
                {row.location_text ?? row.market}
              </Badge>
              {row.source === 'group' && row.group_name && (
                <Badge variant="outline" className="border-sky-200 bg-sky-50 font-normal text-sky-700">
                  {row.group_name}
                </Badge>
              )}
            </div>

            {/* Categorize the "?" ones the title didn't state as sale or lease. */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Sale / lease</span>
              <Select
                value={row.listing_intent}
                onValueChange={(v) => setIntent.mutate({ id: row.id, intent: v as DealRadarIntent })}
              >
                <SelectTrigger className="h-8 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTENT_ORDER.map((i) => (
                    <SelectItem key={i} value={i}>
                      {intentLabels[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              {price && (
                <div>
                  <dt className="text-muted-foreground">Price</dt>
                  <dd className="font-medium">{price}</dd>
                </div>
              )}
              {size && (
                <div>
                  <dt className="text-muted-foreground">Size</dt>
                  <dd>{size}</dd>
                </div>
              )}
              {row.location_text && (
                <div>
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>{row.location_text}</dd>
                </div>
              )}
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button className="flex-1" onClick={() => setCreateOpen(true)}>
                <Handshake className="size-4" />
                Create deal
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => openInNewTab(row.listing_url)}>
                <ExternalLink className="size-4" />
                {row.source === 'group' ? 'View post on Facebook' : 'View listing on Facebook'}
              </Button>
            </div>
            {row.source === 'group' && row.author_name && (
              <p className="-mt-3 text-xs text-muted-foreground">Posted by {row.author_name}</p>
            )}

            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Message to paste</p>
              <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">
                {renderMessage(row)}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Notes</p>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What the seller said, next step…"
                rows={5}
              />
              <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
                Facebook doesn't include the listing description in search results — open the
                listing on Facebook to read the full write-up.
              </p>
            </div>

            <Button className={cn('w-full', !dirty && 'invisible')} onClick={save} disabled={update.isPending}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CreateDealDialog
        row={row}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => onOpenChange(false)}
      />
    </>
  )
}
