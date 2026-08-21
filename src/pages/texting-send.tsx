import { useMemo, useState } from 'react'
import { Loader2, MessageSquare, Pause, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TextingNav } from '@/components/texting-nav'
import {
  useTextingSettings,
  useTodaysSends,
  useVaApproveSend,
  type TextSendStatus,
  type TodaysSend,
} from '@/hooks/use-texting'
import { formatPhone } from '@/lib/format'

function StatusChip({ send }: { send: TodaysSend }) {
  switch (send.status) {
    case 'draft':
      return <Badge variant="outline">Draft</Badge>
    case 'approved':
    case 'queued':
    case 'sending':
      return <Badge variant="secondary">{send.status === 'approved' ? 'Approved' : send.status === 'queued' ? 'Queued' : 'Sending'}</Badge>
    case 'sent':
    case 'delivered':
      return (
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          {send.status === 'sent' ? 'Sent' : 'Delivered'}
        </Badge>
      )
    case 'blocked':
      return <Badge variant="destructive">{send.blocked_reason ?? 'Blocked'}</Badge>
    case 'failed':
      return <Badge variant="destructive">{send.error ?? 'Failed'}</Badge>
  }
}

/**
 * Today's batch — every text_sends row created today, grouped by campaign. Campaigns
 * enqueue DRAFTS; the "Send" tap on each row is the human-initiation step (FTSA posture)
 * that flips it to approved for the worker to claim.
 */
export function TextingSendPage() {
  const { data: sends, isLoading } = useTodaysSends()
  const { data: settings } = useTextingSettings()
  const approve = useVaApproveSend()
  const [approvingId, setApprovingId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const by = (statuses: TextSendStatus[]) =>
      sends?.filter((s) => statuses.includes(s.status)).length ?? 0
    return {
      drafts: by(['draft']),
      approved: by(['approved', 'queued', 'sending']),
      sent: by(['sent', 'delivered']),
      blocked: by(['blocked', 'failed']),
    }
  }, [sends])

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: TodaysSend[] }>()
    for (const s of sends ?? []) {
      const key = s.campaign?.id ?? 'reply'
      const entry = map.get(key) ?? {
        label: s.campaign?.name ?? 'Replies & one-offs',
        rows: [],
      }
      entry.rows.push(s)
      map.set(key, entry)
    }
    return [...map.entries()]
  }, [sends])

  const handleApprove = async (sendId: string) => {
    setApprovingId(sendId)
    try {
      const res = await approve.mutateAsync(sendId)
      if (!res.ok) {
        toast.error(res.reason ?? 'The row could not be approved.')
        return
      }
      toast.success('Approved — it goes out with the next worker pass.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The approval failed.')
    } finally {
      setApprovingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">Today's batch</h1>
          <p className="text-sm text-muted-foreground tabular-nums">
            {counts.drafts} drafts · {counts.approved} approved · {counts.sent} sent ·{' '}
            {counts.blocked} blocked
          </p>
        </div>
        <TextingNav />
      </div>

      {settings?.paused ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <Pause className="size-4 shrink-0" />
          Sending is paused
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !sends?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <MessageSquare className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Nothing queued today — campaign drafts land here.
            </p>
          </CardContent>
        </Card>
      ) : (
        groups.map(([key, group]) => (
          <Card key={key}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {group.label}
                <span className="text-sm font-normal text-muted-foreground tabular-nums">
                  {group.rows.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {group.rows.map((send) => (
                <div key={send.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">
                        {formatPhone(send.phone)}
                      </span>
                      <StatusChip send={send} />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{send.body}</p>
                  </div>
                  {send.status === 'draft' ? (
                    <Button
                      size="sm"
                      className="shrink-0"
                      disabled={approvingId === send.id}
                      onClick={() => handleApprove(send.id)}
                    >
                      {approvingId === send.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      Send
                    </Button>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

export default TextingSendPage
