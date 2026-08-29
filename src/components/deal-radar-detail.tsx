import { useEffect, useState } from 'react'
import { ExternalLink, Mail, Phone } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useUpdateDealRadar, type DealRadarRow } from '@/hooks/use-deal-radar'
import {
  formatRadarPrice,
  formatRadarSize,
  renderMessage,
  statusBadgeClass,
  statusLabels,
  typeBadgeClass,
  typeLabels,
} from '@/lib/deal-radar'
import { openInNewTab } from '@/lib/deal-radar-outreach'
import { formatPhone } from '@/lib/format'
import { cn } from '@/lib/utils'

interface DealRadarDetailProps {
  row: DealRadarRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Per-deal detail: the message that will be pasted, notes the human keeps, and
 * the M5 owner-enrichment backup channel (call/email, separate from Facebook).
 */
export function DealRadarDetail({ row, open, onOpenChange }: DealRadarDetailProps) {
  const update = useUpdateDealRadar()
  const [notes, setNotes] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')

  // Reset the editable fields whenever a different deal opens.
  useEffect(() => {
    setNotes(row?.notes ?? '')
    setPhone(row?.owner_phone ?? '')
    setEmail(row?.owner_email ?? '')
  }, [row?.id, row?.notes, row?.owner_phone, row?.owner_email])

  if (!row) return null

  const price = formatRadarPrice(row)
  const size = formatRadarSize(row)
  const dirty =
    notes !== (row.notes ?? '') ||
    phone !== (row.owner_phone ?? '') ||
    email !== (row.owner_email ?? '')

  function save() {
    update.mutate(
      { id: row!.id, notes: notes || null, owner_phone: phone || null, owner_email: email || null },
      { onSuccess: () => toast('Saved.') },
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="pr-6 text-base leading-snug">{row.title}</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={typeBadgeClass[row.listing_type]}>
              {typeLabels[row.listing_type]}
            </Badge>
            <Badge variant="outline" className={statusBadgeClass[row.status]}>
              {statusLabels[row.status]}
            </Badge>
            <Badge variant="secondary" className="font-normal">
              {row.market}
            </Badge>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {price && (
              <>
                <dt className="text-muted-foreground">Price</dt>
                <dd className="font-medium">{price}</dd>
              </>
            )}
            {size && (
              <>
                <dt className="text-muted-foreground">Size</dt>
                <dd>{size}</dd>
              </>
            )}
            {row.location_text && (
              <>
                <dt className="text-muted-foreground">Location</dt>
                <dd>{row.location_text}</dd>
              </>
            )}
          </dl>

          <Button variant="outline" className="w-full" onClick={() => openInNewTab(row.listing_url)}>
            <ExternalLink className="size-4" />
            {row.source === 'group' ? 'View post on Facebook' : 'View listing on Facebook'}
          </Button>
          {row.source === 'group' && row.author_name && (
            <p className="-mt-3 text-xs text-muted-foreground">Posted by {row.author_name}</p>
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Message to paste</p>
            <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">
              {renderMessage(row)}
            </div>
          </div>

          {/* Owner backup channel — manual (posts rarely carry an address to look up) */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Owner backup channel</p>
            <div className="flex items-center gap-2">
              <Phone className="size-4 shrink-0 text-muted-foreground" />
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Owner phone"
                className="h-9"
              />
              {row.owner_phone && (
                <a href={`tel:${row.owner_phone}`} className="text-xs text-primary underline">
                  {formatPhone(row.owner_phone)}
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Owner email"
                className="h-9"
              />
            </div>
            <p className="text-[11px] leading-tight text-muted-foreground">
              If you ever text these, scrub against DNC and honor TCPA consent — this is a call/email
              backup, separate from the Facebook thread.
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Notes</p>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What the seller said, next step…"
              rows={4}
            />
          </div>

          <Button className={cn('w-full', !dirty && 'invisible')} onClick={save} disabled={update.isPending}>
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
