import { useMemo, useState } from 'react'
import { Download, Loader2, Phone, Send, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { OutreachListPicker } from '@/components/outreach-list-picker'
import {
  channelHoldLabel,
  useCallAudiencePreview,
  type CallAudience,
} from '@/hooks/use-outreach'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { downloadCsv, todayStamp, toCsv } from '@/lib/export-csv'
import { automationEnabled, callN8nWebhook, N8N_PATHS } from '@/lib/n8n'
import { cn } from '@/lib/utils'

/**
 * Calls & texts — the phone channel of the outreach spine.
 *
 * One row per NUMBER (that is GHL's model too: Terrakotta mints one contact per phone). The
 * dialer runs in GHL, so the working end of this page is the push: upsert the list's numbers
 * into GHL tagged list-<name> and dial from there. Holds are channel-local — a wrong NUMBER
 * suppresses only the phone; a "not interested" by phone suppresses the person's calls (and,
 * on the email page, their email); wrong PERSON suppresses everything.
 */

export function OutreachCallsPage() {
  const [lists, setLists] = usePersistentState<string[]>('outreach-call-lists', [])
  const [recentDays, setRecentDays] = useState(14)
  const [preview, setPreview] = useState<CallAudience | null>(null)
  const [pushingList, setPushingList] = useState<string | null>(null)
  const [pushed, setPushed] = useState<string[]>([])
  const audienceMut = useCallAudiencePreview()

  const heldByReason = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of preview?.held ?? []) m.set(h.reason, (m.get(h.reason) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [preview])

  const runPreview = async () => {
    if (!lists.length) {
      toast.error('Pick at least one list.')
      return
    }
    try {
      const res = await audienceMut.mutateAsync({ lists, recent_days: recentDays })
      if (!res?.ok) {
        toast.error(res?.reason ?? 'The audience could not be built.')
        return
      }
      setPreview(res)
      toast.success(
        `${res.counts.callable} callable of ${res.counts.considered} numbers (${res.counts.held} held).`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The preview failed.')
    }
  }

  const exportCsv = () => {
    if (!preview?.callable?.length) return
    const cols = [
      'phone', 'first_name', 'last_name', 'company_name', 'email',
      'phone_grade', 'line_type', 'disposition',
      'property_address', 'property_city', 'property_county',
      'crm_contact_id', 'crm_property_id',
    ] as const
    const rows = preview.callable.map((r) => cols.map((c) => String(r[c] ?? '')))
    const slug = lists.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)
    downloadCsv(`call-sheet-${slug}-${todayStamp()}.csv`, toCsv([...cols], rows))
    toast.success(`${rows.length} numbers exported.`)
  }

  const pushToGhl = async (list: string) => {
    setPushingList(list)
    try {
      await callN8nWebhook(
        `${N8N_PATHS.outreachGhlPush}?key=axis-2026`,
        { list },
        { timeoutMs: 30_000 },
      )
      setPushed((prev) => [...prev, list])
      toast.success(`Pushing ${list} to GHL — Slack will confirm when the tagging is done.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The GHL push failed.')
    } finally {
      setPushingList(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Calls &amp; texts</h1>
        <p className="text-xs text-muted-foreground">
          One row per number. The dialer runs in GHL — push a list there and work it.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" /> 1 · Audience
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <OutreachListPicker channel="phone" selected={lists} onChange={setLists} />
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-1">
              <Label htmlFor="recent-days" className="text-xs">
                Skip anyone called in the last
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="recent-days"
                  type="number"
                  min={0}
                  value={recentDays}
                  onChange={(e) => setRecentDays(Number(e.target.value) || 0)}
                  className="h-8 w-20"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            </div>
            <Button onClick={runPreview} disabled={audienceMut.isPending}>
              {audienceMut.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Building the call sheet…
                </>
              ) : (
                'Preview call sheet'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Phone className="size-4" /> 2 · The call sheet
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <div className="text-xl font-semibold tabular-nums">{preview.counts.considered}</div>
                <div className="text-xs text-muted-foreground">Numbers considered</div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-xl font-semibold tabular-nums">{preview.counts.callable}</div>
                <div className="text-xs text-muted-foreground">Callable</div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-xl font-semibold tabular-nums">{preview.counts.held}</div>
                <div className="text-xs text-muted-foreground">Held back</div>
              </div>
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <div className="text-xl font-semibold tabular-nums">
                  {preview.callable.filter((r) => (r.line_type ?? '').toLowerCase().includes('mobile')).length}
                </div>
                <div className="text-xs text-muted-foreground">Mobiles (textable)</div>
              </div>
            </div>

            {heldByReason.length ? (
              <div className="flex flex-wrap gap-2">
                {heldByReason.map(([reason, n]) => (
                  <Badge key={reason} variant="outline" className="border-amber-200 bg-amber-50">
                    {channelHoldLabel(reason)} · {n}
                  </Badge>
                ))}
              </div>
            ) : null}

            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phone</TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Property</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.callable.map((r) => (
                    <TableRow key={r.phone}>
                      <TableCell className="font-mono text-xs">{r.phone}</TableCell>
                      <TableCell className="text-sm">
                        {[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.company_name ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm">{r.phone_grade ?? '—'}</TableCell>
                      <TableCell
                        className={cn(
                          'text-sm',
                          (r.line_type ?? '').toLowerCase().includes('mobile') && 'text-emerald-700',
                        )}
                      >
                        {r.line_type ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.property_address ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!preview.callable.length ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        Nothing callable — every number was held. Check the reasons above.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={exportCsv} disabled={!preview.callable.length}>
                <Download className="size-4" /> Export call sheet CSV
              </Button>
              {automationEnabled()
                ? lists.map((l) => (
                    <Button
                      key={l}
                      onClick={() => pushToGhl(l)}
                      disabled={pushingList !== null || pushed.includes(l)}
                    >
                      {pushingList === l ? (
                        <>
                          <Loader2 className="size-4 animate-spin" /> Pushing…
                        </>
                      ) : pushed.includes(l) ? (
                        `${l} pushed — check Slack`
                      ) : (
                        <>
                          <Send className="size-4" /> Push {l} to GHL
                        </>
                      )}
                    </Button>
                  ))
                : null}
            </div>
            <p className="text-xs text-muted-foreground">
              The push upserts one GHL contact per number (exact-phone match, email into the{' '}
              <code>Owner Email</code> custom field) and tags them with the list name, so the
              dialer picks the whole list up. Wrong-number and do-not-call numbers never leave
              this page.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export default OutreachCallsPage
