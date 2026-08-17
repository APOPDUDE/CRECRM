import { useMemo, useState } from 'react'
import { Download, Loader2, Mailbox, Users } from 'lucide-react'
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
  useMailAudiencePreview,
  type MailAudience,
} from '@/hooks/use-outreach'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { downloadCsv, todayStamp, toCsv } from '@/lib/export-csv'

/**
 * Postcards — the mail channel of the outreach spine.
 *
 * One row per MAILING ADDRESS, so a couple sharing a mailbox gets one card — which is what a
 * mail house wants. Mail goes to the OWNER's mailing address, never the property. The export
 * is a mail-merge CSV: recipient + mailing address + the property facts the card personalises
 * on ("your building at 123 Main St").
 */

export function OutreachPostcardsPage() {
  const [lists, setLists] = usePersistentState<string[]>('outreach-mail-lists', [])
  const [recentDays, setRecentDays] = useState(120)
  const [preview, setPreview] = useState<MailAudience | null>(null)
  const audienceMut = useMailAudiencePreview()

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
        `${res.counts.mailable} mailable of ${res.counts.considered} addresses (${res.counts.held} held).`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The preview failed.')
    }
  }

  const exportCsv = () => {
    if (!preview?.mailable?.length) return
    const cols = [
      'first_name', 'last_name', 'company_name',
      'mail_address', 'mail_city', 'mail_state', 'mail_zip',
      'property_address', 'property_city', 'property_state', 'property_zip',
      'crm_contact_id', 'crm_property_id',
    ] as const
    const rows = preview.mailable.map((r) => cols.map((c) => String(r[c] ?? '')))
    const slug = lists.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)
    downloadCsv(`postcards-${slug}-${todayStamp()}.csv`, toCsv([...cols], rows))
    toast.success(`${rows.length} addresses exported for the mail house.`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Postcards</h1>
        <p className="text-xs text-muted-foreground">
          One card per mailbox, sent to the owner’s mailing address — never the property.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" /> 1 · Audience
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <OutreachListPicker channel="mail" selected={lists} onChange={setLists} />
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-1">
              <Label htmlFor="recent-days" className="text-xs">
                Skip anyone mailed in the last
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
                  <Loader2 className="size-4 animate-spin" /> Building the mail run…
                </>
              ) : (
                'Preview mail run'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mailbox className="size-4" /> 2 · The mail run
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <div className="text-xl font-semibold tabular-nums">{preview.counts.considered}</div>
                <div className="text-xs text-muted-foreground">Addresses considered</div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-xl font-semibold tabular-nums">{preview.counts.mailable}</div>
                <div className="text-xs text-muted-foreground">Mailable</div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-xl font-semibold tabular-nums">{preview.counts.held}</div>
                <div className="text-xs text-muted-foreground">Held back</div>
              </div>
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <div className="text-xl font-semibold tabular-nums">
                  {preview.mailable.filter((r) => r.crm_property_id).length}
                </div>
                <div className="text-xs text-muted-foreground">Property-linked</div>
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
                    <TableHead>Recipient</TableHead>
                    <TableHead>Mailing address</TableHead>
                    <TableHead>City / state / zip</TableHead>
                    <TableHead>Their property</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.mailable.map((r) => (
                    <TableRow key={`${r.mail_address}|${r.mail_zip ?? ''}`}>
                      <TableCell className="text-sm">
                        {[r.first_name, r.last_name].filter(Boolean).join(' ') ||
                          r.company_name ||
                          '—'}
                      </TableCell>
                      <TableCell className="text-sm">{r.mail_address}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[r.mail_city, r.mail_state, r.mail_zip].filter(Boolean).join(', ') || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.property_address ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!preview.mailable.length ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        Nothing mailable — every address was held. Check the reasons above.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={exportCsv} disabled={!preview.mailable.length}>
                <Download className="size-4" /> Export mail-merge CSV
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Send the CSV to the mail house (or the postcard tool). When a run actually goes
              out, the send gets recorded on the spine so “mailed recently” holds work on the
              next run.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export default OutreachPostcardsPage
