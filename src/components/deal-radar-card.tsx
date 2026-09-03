import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Check, ChevronDown, Copy, ExternalLink, ImageOff, MessageCircle, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMarkApproved, useUpdateDealRadarStatus, type DealRadarRow } from '@/hooks/use-deal-radar'
import {
  formatRadarPrice,
  formatRadarSize,
  intentBadgeClass,
  intentLabels,
  renderMessage,
  STATUS_ORDER,
  statusBadgeClass,
  statusLabels,
  typeBadgeClass,
  typeLabels,
} from '@/lib/deal-radar'
import { copyToClipboard, openInNewTab } from '@/lib/deal-radar-outreach'
import { cn } from '@/lib/utils'

interface DealRadarCardProps {
  row: DealRadarRow
  /** Also open messenger.com in a second tab on Message Seller. */
  openMessenger?: boolean
  /** Open the detail sheet (message preview, owner lookup, notes). */
  onOpenDetail?: (row: DealRadarRow) => void
}

export function DealRadarCard({ row, openMessenger, onOpenDetail }: DealRadarCardProps) {
  const markApproved = useMarkApproved()
  const updateStatus = useUpdateDealRadarStatus()
  const [imgFailed, setImgFailed] = useState(false)

  const price = formatRadarPrice(row)
  const size = formatRadarSize(row)
  const age = row.posted_at ?? row.found_at
  const ageLabel = age ? `${formatDistanceToNow(new Date(age))} ago` : null

  async function handleMessageSeller() {
    const message = renderMessage(row)
    const copied = await copyToClipboard(message)
    openInNewTab(row.listing_url)
    if (openMessenger) openInNewTab('https://www.messenger.com/')
    if (row.status === 'new') markApproved.mutate(row.id)
    toast(copied ? 'Message copied - paste into Messenger. Approved.' : 'Opened listing - copy failed, message shown below.', {
      description: copied ? undefined : message,
    })
  }

  async function copyOnly() {
    const ok = await copyToClipboard(renderMessage(row))
    toast(ok ? 'Message copied.' : 'Copy failed.')
  }

  // Approve (pursuing it) or decline (passed). The row always stays in the DB so the
  // scraper's external_id dedupe never re-adds it as new.
  function handleApprove() {
    if (row.status === 'approved') return
    const prev = row.status
    updateStatus.mutate({ id: row.id, status: 'approved' })
    toast('Approved.', {
      action: { label: 'Undo', onClick: () => updateStatus.mutate({ id: row.id, status: prev }) },
    })
  }
  function handleDecline() {
    if (row.status === 'declined') return
    const prev = row.status
    updateStatus.mutate({ id: row.id, status: 'declined' })
    toast('Declined.', {
      action: { label: 'Undo', onClick: () => updateStatus.mutate({ id: row.id, status: prev }) },
    })
  }

  return (
    <div className="relative flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={handleApprove}
          title="Approve"
          aria-label="Approve this listing"
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-white backdrop-blur transition hover:bg-emerald-600/90',
            row.status === 'approved' ? 'bg-emerald-600/80' : 'bg-black/45',
          )}
        >
          <Check className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDecline}
          title="Decline"
          aria-label="Decline this listing"
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-white backdrop-blur transition hover:bg-red-600/90',
            row.status === 'declined' ? 'bg-red-600/80' : 'bg-black/45',
          )}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => onOpenDetail?.(row)}
        className="relative aspect-[4/3] w-full cursor-pointer bg-muted text-left"
        title="Open details"
      >
        {row.thumbnail_url && !imgFailed ? (
          <img
            src={row.thumbnail_url}
            alt={row.title}
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-8" />
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          <Badge variant="outline" className={cn('backdrop-blur', typeBadgeClass[row.listing_type])}>
            {typeLabels[row.listing_type]}
          </Badge>
          <Badge variant="outline" className={cn('backdrop-blur', intentBadgeClass[row.listing_intent])}>
            {intentLabels[row.listing_intent]}
          </Badge>
          {row.status !== 'new' && (
            <Badge variant="outline" className={cn('backdrop-blur', statusBadgeClass[row.status])}>
              {statusLabels[row.status]}
            </Badge>
          )}
        </div>
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpenDetail?.(row)}
            className="line-clamp-2 cursor-pointer text-left text-sm font-medium leading-snug hover:underline"
            title={row.title}
          >
            {row.title}
          </button>
          {price && <span className="shrink-0 text-sm font-semibold">{price}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {row.source === 'group' && (
            <Badge variant="outline" className="border-sky-200 bg-sky-50 font-normal text-sky-700">
              {row.group_name ?? 'Group'}
            </Badge>
          )}
          {/* The real Facebook location — falls back to the search market for group posts. */}
          <span className="font-medium text-foreground/80">{row.location_text ?? row.market}</span>
          {size && <span>· {size}</span>}
          {ageLabel && <span>· {ageLabel}</span>}
        </div>
        {row.source === 'group' && row.author_name && (
          <p className="text-xs text-muted-foreground">Posted by {row.author_name}</p>
        )}

        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <Button size="sm" className="flex-1" onClick={handleMessageSeller}>
            <Send className="size-3.5" />
            Message seller
          </Button>
          <Button size="sm" variant="outline" onClick={copyOnly} title="Copy message only">
            <Copy className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openInNewTab(row.listing_url)}
            title="View listing on Facebook"
          >
            <ExternalLink className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" title="Set status">
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {STATUS_ORDER.map((s) => (
                <DropdownMenuItem
                  key={s}
                  onClick={() => updateStatus.mutate({ id: row.id, status: s })}
                  className="gap-2"
                >
                  {row.status === s ? <Check className="size-3.5" /> : <span className="size-3.5" />}
                  {s === 'replied' || s === 'negotiating' ? (
                    <MessageCircle className="size-3.5 opacity-60" />
                  ) : null}
                  {statusLabels[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
