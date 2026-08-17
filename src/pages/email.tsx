import { useMemo, useState } from 'react'
import { Download, Loader2, Mail, Send, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  holdLabel,
  missingTokens,
  renderTemplate,
  templateSteps,
  useEmailTemplates,
  useOutreachAudiencePreview,
  type AudienceLead,
  type AudiencePreview,
} from '@/hooks/use-email-campaigns'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { downloadCsv, todayStamp, toCsv } from '@/lib/export-csv'
import { cn } from '@/lib/utils'

/**
 * Email campaigns — pick lists from the OUTREACH SPINE, see what they really are, and export a
 * Smartlead-ready CSV from a template whose copy has measured reply rates behind it.
 *
 * The audience is a Supabase query now (outreach_targets.lists), not a GHL tag pull. That is
 * the whole point of the spine: the Nicole list imported into GHL as 552 contacts of which 45
 * were tagged, and nobody could reconcile it because the list lived only as a GHL tag. Lists
 * live in the CRM; GHL is a push destination for the phone channel.
 *
 * The collapse, the suppression and the identity resolution all happen in Postgres
 * (outreach_audience); this page's whole job is to show Alex the result BEFORE anything is
 * spent. A phone "no" (said_no:phone) and a confirmed wrong person hold automatically; a wrong
 * NUMBER never suppresses the email channel.
 */

const PURPOSE_LABELS: Record<string, string> = {
  off_market_seller: 'Off-market offer',
  buyer_list: 'Buyer list',
  listing_to_nearby: 'New listing',
  space_seeker: 'Client needs space',
  expiring_lease: 'Lease expiring',
  general: 'General',
}

function CountTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: number | string
  tone?: 'good' | 'warn' | 'plain'
  hint?: string
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        tone === 'good' && 'border-emerald-200 bg-emerald-50',
        tone === 'warn' && 'border-amber-200 bg-amber-50',
        (!tone || tone === 'plain') && 'bg-muted/40',
      )}
    >
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

export function EmailPage() {
  const [lists, setLists] = usePersistentState<string[]>('email-outreach-lists', [])
  const [recentDays, setRecentDays] = useState(60)
  const [templateKey, setTemplateKey] = useState<string>('')
  const [campaignName, setCampaignName] = useState('')
  const [previewIdx, setPreviewIdx] = useState(0)
  const [preview, setPreview] = useState<AudiencePreview | null>(null)

  const { data: templates, isLoading: templatesLoading } = useEmailTemplates()
  const audienceMut = useOutreachAudiencePreview()

  const template = useMemo(
    () => (templates ?? []).find((t) => t.key === templateKey),
    [templates, templateKey],
  )
  const steps = useMemo(() => templateSteps(template), [template])

  const audienceLabel = lists.join(' + ')
  const lead: AudienceLead | undefined = preview?.sendable?.[previewIdx]

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
      const res = await audienceMut.mutateAsync({
        lists,
        audience: audienceLabel,
        never_answered: true,
        recent_days: recentDays,
      })
      if (!res?.ok) {
        toast.error(res?.reason ?? 'The audience could not be built.')
        return
      }
      setPreview(res)
      setPreviewIdx(0)
      toast.success(
        `${res.counts.sendable} sendable from ${res.counts.addresses} addresses (${res.counts.held} held).`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The audience preview failed.')
    }
  }

  /**
   * Smartlead's own verification only runs at IMPORT, in its UI ("Launch Verification &
   * Proceed") — never on a live campaign. Alex picked that as the verifier, so a CSV import is
   * the correct path: an API push would silently skip verification entirely. Columns are the
   * canonical merge vocabulary, so the seeded templates render as-is.
   *
   * Exporting is the COMMITTING step: the audience is rebuilt with campaign_id set, which
   * stamps last_campaigned_at on every exported address — the double-send guard. Lose the file?
   * Set "skip anyone emailed" to 0 days and export again; the same rows come back.
   */
  const exportCsv = async () => {
    if (!preview?.sendable?.length) return
    const slug = (audienceLabel || 'audience').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)
    const name = campaignName.trim() || `AXIS · ${audienceLabel} · ${template?.name ?? ''}`
    let committed: AudiencePreview
    try {
      committed = await audienceMut.mutateAsync({
        lists,
        audience: audienceLabel,
        never_answered: true,
        recent_days: recentDays,
        campaign_id: name,
      })
      if (!committed.ok) throw new Error(committed.reason ?? 'audience rebuild failed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The export failed — nothing was stamped.')
      return
    }
    const cols = [
      'email', 'first_name', 'last_name', 'company_name', 'phone_number',
      'owner_name', 'property_address', 'street', 'city', 'county', 'state', 'zip',
      'property_type', 'building_sf', 'land_acres', 'parcel_id',
      'crm_contact_id', 'crm_property_id', 'audience',
    ]
    const rows = committed.sendable.map((l) =>
      cols.map((c) =>
        c === 'email'
          ? l.email
          : c === 'phone_number'
            ? (l.phone_number ?? '')
            : (l.custom_fields?.[c] ?? ''),
      ),
    )
    setPreview(committed)
    downloadCsv(`smartlead-${slug}-${todayStamp()}.csv`, toCsv(cols, rows))
    toast.success(
      `${rows.length} leads exported and marked campaigned. Import into Smartlead and turn verification on at import.`,
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Email campaigns</h1>
        <p className="text-xs text-muted-foreground">
          A second channel for verifying owners — replies write back to the CRM.
        </p>
      </div>

      {/* ---------------------------------------------------------------- 1. Audience */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" /> 1 · Audience
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <OutreachListPicker channel="email" selected={lists} onChange={setLists} />

          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-1">
              <Label htmlFor="recent-days" className="text-xs">
                Skip anyone emailed in the last
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
                  <Loader2 className="size-4 animate-spin" /> Building the audience…
                </>
              ) : (
                'Preview audience'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* --------------------------------------------------------------- The result */}
      {preview ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What that list actually is</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <CountTile label="Addresses considered" value={preview.counts.addresses} />
              <CountTile label="Sendable" value={preview.counts.sendable} tone="good" />
              <CountTile label="Held back" value={preview.counts.held} tone="warn" />
              <CountTile
                label="Consumer mailboxes"
                value={preview.sendable.filter((l) => l.domain_type === 'consumer').length}
                hint="of the sendable"
              />
              <CountTile
                label="Property-linked"
                value={preview.sendable.filter((l) => l.crm_property_id).length}
                hint="personalise from CRM facts"
              />
            </div>

            {heldByReason.length ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">Why the rest are held</div>
                <div className="flex flex-wrap gap-2">
                  {heldByReason.map(([reason, n]) => (
                    <Badge key={reason} variant="outline" className="border-amber-200 bg-amber-50">
                      {holdLabel(reason)} · {n}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="max-h-80 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Address</TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead className="text-right">Lists</TableHead>
                    <TableHead>In CRM</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sendable.map((l, i) => (
                    <TableRow
                      key={l.email}
                      onClick={() => setPreviewIdx(i)}
                      className={cn('cursor-pointer', i === previewIdx && 'bg-muted/60')}
                    >
                      <TableCell className="font-mono text-xs">{l.email}</TableCell>
                      <TableCell className="text-sm">
                        {[l.first_name, l.last_name].filter(Boolean).join(' ') || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {l.custom_fields?.property_address ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(l as unknown as { lists?: string[] }).lists?.length ?? 1}
                      </TableCell>
                      <TableCell>
                        {l.crm_contact_id ? (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50">
                            yes
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">new</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!preview.sendable.length ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        Nothing sendable — every address was held. Check the reasons above.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- 2. Sequence */}
      {preview && preview.sendable.length ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="size-4" /> 2 · Sequence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="template">Template</Label>
                <Select value={templateKey} onValueChange={setTemplateKey}>
                  <SelectTrigger id="template" className="w-80">
                    <SelectValue
                      placeholder={templatesLoading ? 'Loading…' : 'Pick the copy to send'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(templates ?? []).map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {PURPOSE_LABELS[t.purpose] ?? t.purpose} — {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {lead ? (
                <div className="space-y-1">
                  <Label className="text-xs">Previewing as</Label>
                  <div className="font-mono text-xs text-muted-foreground">{lead.email}</div>
                </div>
              ) : null}
            </div>

            {template?.evidence ? (
              <div className="rounded-md border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Why this copy: </span>
                {template.evidence}
              </div>
            ) : null}

            {steps.map((step) => {
              const v = step.variants[0]
              if (!v) return null
              const missing = [
                ...new Set([
                  ...missingTokens(v.subject ?? '', lead),
                  ...missingTokens(v.body ?? '', lead),
                ]),
              ]
              return (
                <div key={step.seq_number} className="rounded-md border">
                  <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
                    <span className="font-medium">Step {step.seq_number}</span>
                    <span className="text-muted-foreground">
                      {step.seq_number === 1 ? 'immediately' : `+${step.delay_days} days`}
                    </span>
                    {step.variants.length > 1 ? (
                      <Badge variant="outline">A/B · {step.variants.length} variants</Badge>
                    ) : null}
                    {missing.length ? (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50">
                        blank for this lead: {missing.join(', ')}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="space-y-2 px-3 py-2">
                    {v.subject ? (
                      <div className="text-sm font-medium">{renderTemplate(v.subject, lead)}</div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic">
                        no subject — threads onto the first email
                      </div>
                    )}
                    <pre className="text-sm whitespace-pre-wrap text-muted-foreground">
                      {renderTemplate(v.body ?? '', lead)}
                    </pre>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ 3. Export */}
      {preview && preview.sendable.length && template ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="size-4" /> 3 · Build the campaign
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="campaign-name">Campaign name</Label>
                <Input
                  id="campaign-name"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder={`AXIS · ${audienceLabel} · ${template.name}`}
                  className="w-96"
                />
              </div>
              <Button onClick={exportCsv}>
                <Download className="size-4" /> Export CSV for Smartlead
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>Export the CSV</strong> and import it into Smartlead with verification
              turned on. Smartlead only verifies at import — never on a live campaign — so a
              direct API push would skip the check you chose as the verifier. The whole account
              can send 230 emails a day across every campaign, so keep the daily number modest
              while a list is new.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export default EmailPage
