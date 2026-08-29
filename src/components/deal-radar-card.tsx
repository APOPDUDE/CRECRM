import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Check, ChevronDown, Copy, ExternalLink, ImageOff, MessageCircle, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMarkMessaged, useUpdateDealRadarStatus, type DealRadarRow } from '@/hooks/use-deal-radar'
import {
  formatRadarPrice,
  formatRadarSize,
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
  const markMessaged = useMarkMessaged()
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
    if (row.status === 'new') markMessaged.mutate(row.id)
    toast(copied ? 'Message copied - paste into Messenger.' : 'Opened listing - copy failed, message shown below.', {
      description: copied ? undefined : message,
    })
  }

  async function copyOnly() {
    const ok = await copyToClipboard(renderMessage(row))
    toast(ok ? 'Message copied.' : 'Copy failed.')
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
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
        <div className="absolute left-2 top-2 flex gap-1.5">
          <Badge variant="outline" className={cn('backdrop-blur', typeBadgeClass[row.listing_type])}>
            {typeLabels[row.listing_type]}
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
          <Badge variant="secondary" className="font-normal">
            {row.market}
          </Badge>
          {row.source === 'group' ? (
            <Badge variant="outline" className="border-sky-200 bg-sky-50 font-normal text-sky-700">
              {row.group_name ?? 'Group'}
            </Badge>
          ) : null}
          {row.location_text && <span>{row.location_text}</span>}
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
