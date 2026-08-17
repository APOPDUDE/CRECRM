import { useMemo, useState } from 'react'
import { AlertTriangle, Download, Loader2, Mail, Send, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  holdLabel,
  missingTokens,
  renderTemplate,
  templateSteps,
  useAudiencePreview,
  useEmailLeadLists,
  useEmailTemplates,
  useLaunchEmailCampaign,
  usePoolAudiencePreview,
  type AudienceLead,
  type AudiencePreview,
} from '@/hooks/use-email-campaigns'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { downloadCsv, todayStamp, toCsv } from '@/lib/export-csv'
import { automationEnabled } from '@/lib/n8n'
import { cn } from '@/lib/utils'

/**
 * Email campaigns — pick a GHL tagged list, see what it really is, and build a Smartlead
 * campaign from a template whose copy has measured reply rates behind it.
 *
 * The number that justifies this page: the tag "2810 buyers" holds 194 GHL contact rows, but
 * they are 66 people. Terrakotta mints one contact per PHONE NUMBER, so the same person, the
 * same property and the same address repeat up to five times. Handing a tag straight to
 * Smartlead mails one human five times from one campaign. The collapse, the suppression and the
 * identity resolution all happen in Postgres (email_audience_build); this page's whole job is to
 * show Alex the result BEFORE anything is spent.
 */

/** Suggestions only — a tag typed here is passed through verbatim, and a wrong one previews as 0. */
const SUGGESTED_TAGS = [
  '2810 buyers',
  'list-nicole-verified-contacts-already',
  'list-nicole-x2',
  'owner-verified',
  'buyer',
]

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
  /**
   * Two audience sources, one page. GHL tags go out through n8n (the private token must never
   * reach the bundle); the pool is a straight RPC. Both return the identical shape, so everything
   * below this line is source-agnostic.
   */
  const [source, setSource] = usePersistentState<'ghl' | 'pool'>('email-audience-source', 'ghl')
  const [poolLists, setPoolLists] = usePersistentState<string[]>('email-pool-lists', [])
  const [tags, setTags] = usePersistentState<string[]>('email-audience-tags', [])
  const [tagDraft, setTagDraft] = useState('')
  // Alex 2026-08-17: "use all the emails" -- business domains are in by default.
  const [allowBusiness, setAllowBusiness] = useState(true)
  const [recentDays, setRecentDays] = useState(60)
  const [templateKey, setTemplateKey] = useState<string>('')
  const [campaignName, setCampaignName] = useState('')
  const [dailyCap, setDailyCap] = useState(20)
  const [previewIdx, setPreviewIdx] = useState(0)
  const [preview, setPreview] = useState<AudiencePreview | null>(null)

  const { data: templates, isLoading: templatesLoading } = useEmailTemplates()
  const { data: leadLists } = useEmailLeadLists()
  const previewMut = useAudiencePreview()
  const poolMut = usePoolAudiencePreview()
  const launchMut = useLaunchEmailCampaign()
  const pending = previewMut.isPending || poolMut.isPending

  const template = useMemo(
    () => (templates ?? []).find((t) => t.key === templateKey),
    [templates, templateKey],
  )
  const steps = useMemo(() => templateSteps(template), [template])

  const audienceLabel = (source === 'pool' ? poolLists : tags).join(' + ')
  const lead: AudienceLead | undefined = preview?.sendable?.[previewIdx]

  const heldByReason = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of preview?.held ?? []) m.set(h.reason, (m.get(h.reason) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [preview])

  const addTag = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    setTags((prev) => (prev.includes(t) ? prev : [...prev, t]))
    setTagDraft('')
  }

  const runPreview = async () => {
    const picked = source === 'pool' ? poolLists : tags
    if (!picked.length) {
      toast.error(source === 'pool' ? 'Pick at least one list.' : 'Pick at least one GHL tag.')
      return
    }
    try {
      const res =
        source === 'pool'
          ? await poolMut.mutateAsync({
              lists: poolLists,
              audience: audienceLabel,
              never_answered: true,
              recent_days: recentDays,
            })
          : await previewMut.mutateAsync({
              tags,
              audience: audienceLabel,
              allow_business_domains: allowBusiness,
              recent_days: recentDays,
            })
      if (!res?.ok) {
        toast.error(res?.reason ?? 'The audience could not be built.')
        return
      }
      setPreview(res)
      setPreviewIdx(0)
      toast.success(
        source === 'pool'
          ? `${res.counts.sendable} sendable from ${res.counts.addresses} pooled addresses (${res.counts.held} held).`
          : `${res.counts.sendable} sendable from ${res.counts.ghl_rows} GHL rows (${res.counts.held} held).`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The audience preview failed.')
    }
  }

  /**
   * Smartlead's own verification only runs at IMPORT, in its UI ("Launch Verification &
   * Proceed") — never on a live campaign. Alex picked that as the verifier, so a CSV import is
   * the correct path for a pool campaign: an API push would silently skip verification entirely.
   * Columns are the canonical merge vocabulary, so the seeded templates render as-is.
   */
  const exportCsv = () => {
    if (!preview?.sendable?.length) return
    const cols = [
      'email', 'first_name', 'last_name', 'company_name', 'phone_number',
      'owner_name', 'property_address', 'street', 'city', 'county', 'state', 'zip',
      'property_type', 'building_sf', 'land_acres', 'parcel_id',
      'crm_contact_id', 'crm_property_id', 'audience',
    ]
    const rows = preview.sendable.map((l) =>
      cols.map((c) =>
        c === 'email'
          ? l.email
          : c === 'phone_number'
            ? (l.phone_number ?? '')
            : (l.custom_fields?.[c] ?? ''),
      ),
    )
    const slug = (audienceLabel || 'audience').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)
    downloadCsv(`smartlead-${slug}-${todayStamp()}.csv`, toCsv(cols, rows))
    toast.success(
      `${rows.length} leads exported. Import into Smartlead and turn verification on at import.`,
    )
  }

  const launch = async () => {
    if (!preview || !template) return
    try {
      const res = await launchMut.mutateAsync({
        tags,
        audience: audienceLabel,
        allow_business_domains: allowBusiness,
        recent_days: recentDays,
        template_key: template.key,
        campaign_name: campaignName.trim() || `AXIS · ${audienceLabel} · ${template.name}`,
        daily_cap: dailyCap,
        mode: 'stage',
      })
      toast.success(
        res?.queued
          ? 'Building the campaign in Smartlead — it will land as a draft, and Slack will confirm.'
          : 'Sent to the launcher.',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The launch failed.')
    }
  }

  if (!automationEnabled()) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Email campaigns</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Automation isn’t configured for this environment, so campaigns can’t be built here.
          </CardContent>
        </Card>
      </div>
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
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['ghl', 'GHL tagged list'],
                ['pool', 'Email pool — never answered'],
              ] as const
            ).map(([v, label]) => (
              <Button
                key={v}
                size="sm"
                variant={source === v ? 'default' : 'outline'}
                onClick={() => {
                  setSource(v)
                  setPreview(null)
                }}
              >
                {label}
              </Button>
            ))}
          </div>

          {source === 'pool' ? (
            <div className="space-y-2">
              <Label>Lists to re-mail</Label>
              <div className="max-h-64 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>List</TableHead>
                      <TableHead className="text-right">Never answered</TableHead>
                      <TableHead className="text-right">Addresses</TableHead>
                      <TableHead className="text-right">Replied</TableHead>
                      <TableHead className="text-right">Bounced</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(leadLists ?? []).map((l) => (
                      <TableRow key={l.list ?? ''}>
                        <TableCell>
                          <Checkbox
                            checked={poolLists.includes(l.list ?? '')}
                            onCheckedChange={(v) =>
                              setPoolLists((prev) =>
                                v === true
                                  ? [...prev, l.list ?? '']
                                  : prev.filter((x) => x !== (l.list ?? '')),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell className="text-sm">{l.list}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {l.never_answered}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {l.addresses}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {l.replied}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {l.bounced}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Every address we hold from Smartlead and GHL lives in the pool — they are{' '}
                <strong>not</strong> contacts, and they stay off the property card until somebody
                actually replies. Anyone who replied, bounced or opted out is filtered out
                automatically.
              </p>
            </div>
          ) : (
          <div className="space-y-2">
            <Label htmlFor="email-tag">GHL tags</Label>
            <div className="flex flex-wrap items-center gap-2">
              {tags.map((t) => (
                <Badge key={t} variant="outline" className="gap-1 py-1">
                  {t}
                  <button
                    type="button"
                    aria-label={`Remove ${t}`}
                    onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                    className="ml-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              <Input
                id="email-tag"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addTag(tagDraft)
                  }
                }}
                onBlur={() => addTag(tagDraft)}
                placeholder="Type a tag and press Enter…"
                className="h-8 w-56"
                list="email-tag-suggestions"
              />
              <datalist id="email-tag-suggestions">
                {SUGGESTED_TAGS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <p className="text-xs text-muted-foreground">
              Contacts carrying any of these tags. People tagged <code>dnc</code>,{' '}
              <code>do not call</code>, <code>not interested</code> or <code>wrong person</code>{' '}
              are always held back, whichever list they’re on.
            </p>
          </div>
          )}

          <div className="flex flex-wrap items-end gap-6">
            {source === 'ghl' ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allowBusiness}
                  onCheckedChange={(v) => setAllowBusiness(v === true)}
                />
                Include business-domain addresses
              </label>
            ) : null}
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
            <Button onClick={runPreview} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />{' '}
                  {source === 'pool' ? 'Reading the pool…' : 'Reading GHL…'}
                </>
              ) : (
                'Preview audience'
              )}
            </Button>
          </div>

          {source === 'ghl' && !allowBusiness ? (
            <p className="flex items-start gap-2 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Business-domain addresses are held by default. Skip-traced corporate addresses carry
              name collisions — a surname matched to a big company’s domain — and a cold pitch to
              the wrong executive is a reputation problem, not a bounce.
            </p>
          ) : null}
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
              <CountTile
                label={source === 'pool' ? 'Pooled addresses' : 'GHL contact rows'}
                value={source === 'pool' ? preview.counts.addresses : preview.counts.ghl_rows}
              />
              <CountTile
                label="Distinct addresses"
                value={preview.counts.addresses}
                hint={source === 'pool' ? 'already one row per address' : 'one row per phone collapsed'}
              />
              <CountTile label="Sendable" value={preview.counts.sendable} tone="good" />
              <CountTile label="Held back" value={preview.counts.held} tone="warn" />
              <CountTile
                label="Consumer mailboxes"
                value={preview.sendable.filter((l) => l.domain_type === 'consumer').length}
                hint="of the sendable"
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
                    <TableHead className="text-right">
                      {source === 'pool' ? 'Lists' : 'GHL rows'}
                    </TableHead>
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
                        {source === 'pool'
                          ? ((l as unknown as { lists?: string[] }).lists?.length ?? 1)
                          : l.ghl_rows_collapsed}
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

      {/* ------------------------------------------------------------------ 3. Launch */}
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
              <div className="space-y-1">
                <Label htmlFor="daily-cap" className="text-xs">
                  Send per day
                </Label>
                <Input
                  id="daily-cap"
                  type="number"
                  min={1}
                  value={dailyCap}
                  onChange={(e) => setDailyCap(Number(e.target.value) || 1)}
                  className="h-9 w-24"
                />
              </div>
              <Button variant="outline" onClick={exportCsv}>
                <Download className="size-4" /> Export CSV for Smartlead
              </Button>
              {source === 'ghl' ? (
                <Button onClick={launch} disabled={launchMut.isPending}>
                  {launchMut.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Building…
                    </>
                  ) : (
                    `Build draft for ${preview.counts.sendable}`
                  )}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {source === 'pool' ? (
                <>
                  <strong>Export the CSV</strong> and import it into Smartlead with verification
                  turned on. Smartlead only verifies at import — never on a live campaign — so a
                  direct API push would skip the check you chose as the verifier.
                </>
              ) : (
                <>
                  This creates the campaign in Smartlead as a <strong>draft</strong> and enrols the
                  leads — it does not start sending. Review it in Smartlead and start it there.
                </>
              )}{' '}
              The whole account can send 230 emails a day across every campaign, so keep the daily
              number modest while a list is new.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export default EmailPage
