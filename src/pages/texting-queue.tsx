import { Link } from 'react-router-dom'
import { formatDistanceToNowStrict } from 'date-fns'
import { ChevronRight, MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TextingNav } from '@/components/texting-nav'
import { TRIAGE_LABELS, useVaQueue } from '@/hooks/use-texting'
import { formatPhone, normalizePhone } from '@/lib/format'

/**
 * The reply queue — threads where a person texted back and a human owes them an answer.
 * Oldest inbound first. Clicking a card opens the thread console.
 */
export function TextingQueuePage() {
  const { data: queue, isLoading } = useVaQueue()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Replies</h1>
        <TextingNav />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !queue?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <MessageSquare className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No replies waiting — new responses land here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {queue.map((thread) => (
            <Link
              key={thread.id}
              to={`/texting/thread/${normalizePhone(thread.phone) ?? thread.phone}`}
              className="block"
            >
              <Card className="transition-colors hover:bg-muted/40">
                <CardContent className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">
                        {formatPhone(thread.phone)}
                      </span>
                      {thread.triage ? (
                        <Badge variant="outline">{TRIAGE_LABELS[thread.triage]}</Badge>
                      ) : null}
                      {thread.last_inbound_at ? (
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNowStrict(new Date(thread.last_inbound_at), {
                            addSuffix: true,
                          })}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {thread.preview ?? '—'}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default TextingQueuePage
