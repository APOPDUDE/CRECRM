import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { OwnerRecipientDetail } from '@/components/owner-recipient-detail'
import { formatDate } from '@/lib/dates'
import { formatPhone } from '@/lib/format'
import { renderFor, variantCount } from '@/lib/message-template'
import { cn } from '@/lib/utils'

const BLAST_URL = 'https://n8n.ayxco.com/webhook/buyer-blast'

export type OwnerRecipient = {
  /** the property id — one recipient per building, which is what makes the message theirs */
  recipientId: string
  /** the owner entity behind it, so the context pane can pull their whole history */
  ownerId: string | null
  /** null when we hold no number — shown in the list anyway, so the gap is visible */
  phone: string | null
  first: string | null
  last: string | null
  company: string | null
  address: string | null
  /** last call/note/meeting on this owner, from v_property_owner_context */
  lastContactedAt: string | null
  /** what makes the message theirs: the building they own */
  ctx: Record<string, string | null>
  /** GHL custom fields, so the owner record stays as rich as the tag-only push made it */
  cf?: { id: string; field_value: string }[]
}

type Mode = 'draft' | 'send'

/**
 * How far apart the texts go out. A blast is one person typing, so it cannot arrive as a
 * burst — but the right gap depends on the list: a dozen warm owners can go quickly, a few
 * hundred cold ones should trickle. The workflow randomises within whichever range is
 * picked, so no two sends are the same distance apart.
 */
const PACE_OPTIONS = [
  { id: '1-3', label: '1–3 min', min: 1, max: 3 },
  { id: '5-15', label: '5–15 min', min: 5, max: 15 },
  { id: '15-30', label: '15–30 min', min: 15, max: 30 },
  { id: '30-60', label: '30–60 min', min: 30, max: 60 },
] as const

const DEFAULT_PACE = '5-15'

/**
 * Two templates, because a cold owner and one you have already spoken to are not the
 * same conversation. Both go out over the same Blooio line — there is no carrier lane
 * on this account — so the difference has to live in what the message says.
 */
export const OWNER_TEMPLATES: { id: string; label: string; hint: string; body: string }[] = [
  {
    id: 'cold',
    label: 'Cold — never spoken',
    hint: 'Short, names their building, asks almost nothing. The only job is a reply.',
    body:
      '{Hi|Hey} {{contact.first_name || "there"}}, Alex Poplawski here — industrial broker in Tampa Bay. ' +
      '{Noticed|Saw} you own {{property.address}}{{property.city_suffix}}. ' +
      '{Any interest in|Open to} hearing what it would trade for {these days|right now}?',
  },
  {
    id: 'requirement',
    label: 'Warm — I have a tenant',
    hint: 'For owners you have spoken to. Leads with a real requirement, not a check-in.',
    body:
      '{Hi|Hey} {{contact.first_name || "there"}}, Alex Poplawski — we spoke about ' +
      '{{property.street || "your site"}} {a while back|a couple months ago}. ' +
      "I'm working with {{campaign.tenant || \"a tenant\"}} whose lease is coming due and " +
      '{{property.address}} {fits what they need|is close to what they are after}. ' +
      '{Do you have a minute to talk?|Worth a quick call?}',
  },
  {
    id: 'comp',
    label: 'Warm — market news',
    hint: 'For owners you have spoken to. Gives them something before asking for anything.',
    body:
      '{Hi|Hey} {{contact.first_name || "there"}}, Alex Poplawski. ' +
      '{Thought you would want to know|Figured this was worth passing on} — ' +
      '{{campaign.comp || "a property near you"}} just {{campaign.comp_event || "traded"}}. ' +
      '{Want to know what that means for|Curious what that does to} ' +
      '{{property.address}}?',
  },
]

/**
 * Message the owners currently in the War Room view.
 *
 * Same workflow the Buyers page uses, with `audienceTag: 'owner-verified'` — one blast
 * path rather than two that drift. Draft is the default: it writes the exact text on each
 * GHL contact as a note and sends nothing.
 */
export function OwnerOutreachDialog({
  open,
  onOpenChange,
  recipients,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  recipients: OwnerRecipient[]
}) {
  const [segment, setSegment] = useState('')
  const [templateId, setTemplateId] = useState(OWNER_TEMPLATES[0].id)
  const [message, setMessage] = useState(OWNER_TEMPLATES[0].body)
  const [tenant, setTenant] = useState('')
  const [comp, setComp] = useState('')
  const [mode, setMode] = useState<Mode>('draft')
  const [activity, setActivity] = useState<'all' | 'recent' | 'quiet'>('all')
  const [deselected, setDeselected] = useState<Set<string>>(new Set())
  /** recipientId whose property + history is open, or null while showing the list */
  const [inspecting, setInspecting] = useState<string | null>(null)
  const [paceId, setPaceId] = useState<string>(DEFAULT_PACE)
  const [busy, setBusy] = useState(false)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    setSegment('')
    setTemplateId(OWNER_TEMPLATES[0].id)
    setMessage(OWNER_TEMPLATES[0].body)
    setTenant('')
    setComp('')
    setMode('draft')
    setActivity('all')
    setDeselected(new Set())
    setInspecting(null)
  }, [open])

  const pickTemplate = (id: string) => {
    setTemplateId(id)
    setMessage(OWNER_TEMPLATES.find((t) => t.id === id)!.body)
  }

  // Campaign-level facts are the same for everyone in the blast; per-owner facts come
  // from their own record.
  const campaignCtx = useMemo(
    () => ({ 'campaign.tenant': tenant.trim() || null, 'campaign.comp': comp.trim() || null }),
    [tenant, comp],
  )

  const preview = (r: OwnerRecipient | undefined) =>
    r ? renderFor(message, r.recipientId, { ...r.ctx, ...campaignCtx }) : ''

  const variants = useMemo(() => variantCount(message), [message])

  // "Recent" is 30 days of ANY logged contact — call, note or meeting. Which side you
  // want depends on the message: a market-news touch suits people you have spoken to,
  // a cold opener is wasted on someone you rang last week.
  const DAYS = 30
  const cutoff = useMemo(() => Date.now() - DAYS * 86400000, [])
  const isRecent = (r: OwnerRecipient) =>
    r.lastContactedAt != null && new Date(r.lastContactedAt).getTime() >= cutoff

  const inScope = useMemo(
    () =>
      recipients.filter((r) =>
        activity === 'all' ? true : activity === 'recent' ? isRecent(r) : !isRecent(r),
      ),
    [recipients, activity, cutoff],
  )
  const toggleRecipient = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // The open recipient is located inside the CURRENT filter, so changing the filter while
  // a pane is open drops back to the list rather than showing someone no longer in scope.
  const inspectIndex = inspecting ? inScope.findIndex((r) => r.recipientId === inspecting) : -1
  const inspected = inspectIndex >= 0 ? inScope[inspectIndex] : null
  const step = (by: number) => {
    if (inScope.length === 0) return
    const next = (inspectIndex + by + inScope.length) % inScope.length
    setInspecting(inScope[next].recipientId)
  }

  const textable = useMemo(() => inScope.filter((r) => r.phone), [inScope])
  const noPhone = useMemo(() => inScope.filter((r) => !r.phone), [inScope])
  const sending = useMemo(
    () => textable.filter((r) => !deselected.has(r.recipientId)),
    [textable, deselected],
  )
  const allOn = textable.length > 0 && sending.length === textable.length
  const toggleAll = () =>
    setDeselected((prev) => {
      const next = new Set(prev)
      if (allOn) textable.forEach((r) => next.add(r.recipientId))
      else textable.forEach((r) => next.delete(r.recipientId))
      return next
    })
  const pace = PACE_OPTIONS.find((p) => p.id === paceId) ?? PACE_OPTIONS[1]
  /** Rough wall-clock for the whole run, using the midpoint of the chosen gap. */
  const runEstimate = (() => {
    const mins = Math.round(sending.length * ((pace.min + pace.max) / 2))
    if (mins < 90) return `${mins} minute${mins === 1 ? '' : 's'}`
    return `${(mins / 60).toFixed(1)} hours`
  })()
  const shown = sending.slice(0, 2)
  const needsTenant = message.includes('{{campaign.tenant') && !tenant.trim()
  const needsComp = message.includes('{{campaign.comp') && !comp.trim()

  const push = async () => {
    if (!segment.trim() || !message.trim() || sending.length === 0) return
    setBusy(true)
    try {
      const res = await fetch(BLAST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segmentName: segment.trim(),
          message: message.trim(),
          mode,
          audienceTag: 'owner-verified',
          // How far apart the sends go. The workflow picks a fresh random gap in this range
          // per message, so a blast never lands on a machine-perfect cadence.
          paceMinMinutes: pace.min,
          paceMaxMinutes: pace.max,
          recipients: sending.map((r) => ({
            ...r,
            ctx: { ...r.ctx, ...campaignCtx },
          })),
        }),
      })
      if (!res.ok) throw new Error(`blast failed (${res.status})`)
      const raw = await res.text()
      if (!raw.trim()) {
        throw new Error('the automation errored before it finished — check the n8n execution log')
      }
      const r = JSON.parse(raw) as { tag: string; queued?: number; drafted?: number }
      const n = r.queued ?? r.drafted ?? sending.length
      toast.success(
        mode === 'send' ? `Queued ${n} iMessage${n === 1 ? '' : 's'}` : `Drafted for ${n} owner${n === 1 ? '' : 's'}`,
        {
          description:
            mode === 'send'
              ? `Going out 5 to 15 minutes apart — about ${Math.round(n * 10) >= 90 ? (Math.round(n * 10) / 60).toFixed(1) + ' hours' : Math.round(n * 10) + ' minutes'} for the batch. Tag: ${r.tag}.`
              : `Written on each contact as a note. Nothing was sent. Tag: ${r.tag}.`,
        },
      )
      onOpenChange(false)
    } catch (e) {
      toast.error('Could not push the blast', {
        description: e instanceof Error ? e.message : 'unknown error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Message these owners</DialogTitle>
          <DialogDescription>
            {sending.length.toLocaleString()} owner{sending.length === 1 ? '' : 's'} get tagged in GoHighLevel and the message written on their contact. Everything goes
            over the Blooio line — there is no separate SMS lane on this account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="owner-segment">Segment name</Label>
          <Input
            id="owner-segment"
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            placeholder="East Tampa owners — Aug"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label>Template</Label>
          <div className="grid gap-1.5">
            {OWNER_TEMPLATES.map((t) => (
              <label
                key={t.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm',
                  templateId === t.id && 'border-primary/50 bg-accent/40',
                )}
              >
                <input
                  type="radio"
                  name="owner-template"
                  className="mt-1 size-4 accent-primary"
                  checked={templateId === t.id}
                  onChange={() => pickTemplate(t.id)}
                />
                <span>
                  <span className="font-medium">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {message.includes('{{campaign.tenant') && (
          <div className="space-y-2">
            <Label htmlFor="owner-tenant">Who you're representing</Label>
            <Input
              id="owner-tenant"
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              placeholder="an aluminum fabricator"
            />
          </div>
        )}

        {message.includes('{{campaign.comp') && (
          <div className="space-y-2">
            <Label htmlFor="owner-comp">The nearby deal</Label>
            <Input
              id="owner-comp"
              value={comp}
              onChange={(e) => setComp(e.target.value)}
              placeholder="4643 73rd Ave, at $143/SF"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="owner-message">Message</Label>
          <Textarea
            id="owner-message"
            ref={messageRef}
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span className="tabular-nums">{message.length} characters</span>
            <span className="tabular-nums">
              {variants === 1 ? 'identical wording for everyone' : `${variants} wordings in rotation`}
            </span>
          </div>
          {(needsTenant || needsComp) && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              Fill in {needsTenant ? 'who you’re representing' : 'the nearby deal'} — right now that
              part of the message falls back to something vague, which is the opposite of the point.
            </p>
          )}
        </div>

        {shown.length > 0 && (
          <div className="space-y-2">
            {shown.map((r) => (
              <div key={r.recipientId} className="rounded-md border bg-muted/40 p-2.5">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  As {[r.first, r.last].filter(Boolean).join(' ') || r.company || 'this owner'}{' '}
                  receives it
                </p>
                <p className="whitespace-pre-wrap text-sm">{preview(r)}</p>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Who gets it</Label>
            <div className="flex items-center rounded-full border p-0.5">
              {(
                [
                  ['all', 'Everyone'],
                  ['recent', 'Touched in 30d'],
                  ['quiet', 'Quiet 30d+'],
                ] as ['all' | 'recent' | 'quiet', string][]
              ).map(([v, label]) => (
                <Button
                  key={v}
                  type="button"
                  variant={activity === v ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 rounded-full px-2.5 text-xs font-normal"
                  onClick={() => setActivity(v)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {inspected ? (
            <OwnerRecipientDetail
              recipient={inspected}
              index={inspectIndex}
              total={inScope.length}
              included={!!inspected.phone && !deselected.has(inspected.recipientId)}
              canInclude={!!inspected.phone}
              onToggleInclude={() => toggleRecipient(inspected.recipientId)}
              onBack={() => setInspecting(null)}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
            />
          ) : (
          <div className="max-h-56 overflow-y-auto rounded-lg border">
            {inScope.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                Nobody matches that filter.
              </p>
            ) : (
              <>
                <label className="flex items-center gap-2 border-b bg-muted/40 px-2.5 py-1.5 text-xs">
                  <Checkbox
                    checked={allOn}
                    onCheckedChange={toggleAll}
                    disabled={textable.length === 0}
                    aria-label={allOn ? 'Clear all' : 'Select all'}
                  />
                  <span className="text-muted-foreground">
                    {sending.length} of {textable.length} textable
                    {noPhone.length > 0 && ` · ${noPhone.length} with no number`}
                  </span>
                </label>
                <ul className="divide-y">
                  {inScope.map((r) => {
                    const on = !!r.phone && !deselected.has(r.recipientId)
                    return (
                      <li
                        key={r.recipientId}
                        className={cn(
                          'flex items-center gap-2 px-2.5 py-1.5 text-sm',
                          !r.phone && 'bg-muted/30',
                        )}
                      >
                        {r.phone ? (
                          <Checkbox
                            checked={on}
                            onCheckedChange={() => toggleRecipient(r.recipientId)}
                            aria-label={`Text ${r.first ?? r.company ?? 'this owner'}`}
                          />
                        ) : (
                          <span className="w-4 text-center text-[10px] text-muted-foreground">—</span>
                        )}
                        {/* the name opens the building + history; the checkbox stays its own
                            target so ticking someone off never costs a round trip */}
                        <button
                          type="button"
                          onClick={() => setInspecting(r.recipientId)}
                          className="min-w-0 flex-1 truncate text-left hover:underline"
                          title="See the property and conversation"
                        >
                          <span className={cn(!r.phone && 'text-muted-foreground')}>
                            {[r.first, r.last].filter(Boolean).join(' ') || r.company || 'Unknown'}
                          </span>
                          <span className="text-muted-foreground"> · {r.address ?? 'no address'}</span>
                        </button>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {r.phone ? formatPhone(r.phone) : 'no number'}
                        </span>
                        <span className="w-20 shrink-0 text-right text-[10px] text-muted-foreground">
                          {r.lastContactedAt ? formatDate(r.lastContactedAt) : 'never'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
          )}
          {!inspected && noPhone.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {noPhone.length} owner{noPhone.length === 1 ? '' : 's'} here {noPhone.length === 1 ? 'has' : 'have'} no
              number — verified by email only. Export them from the War Room to skip-trace.
            </p>
          )}
        </div>

        <div className="space-y-1.5 rounded-lg border p-3">
          {(
            [
              ['draft', 'Draft only', 'Writes the text on each contact as a note. Nothing leaves.'],
              [
                'send',
                'Send now over iMessage',
                `Goes out through Blooio, ${pace.label} apart — about ${runEstimate} for ${sending.length}.`,
              ],
            ] as [Mode, string, string][]
          ).map(([v, label, hint]) => (
            <label key={v} className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="radio"
                name="owner-mode"
                className="mt-1 size-4 accent-primary"
                checked={mode === v}
                onChange={() => setMode(v)}
              />
              <span>
                <span className={cn('font-medium', v === 'send' && mode === 'send' && 'text-amber-700')}>
                  {label}
                </span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}

          {mode === 'send' && (
            <div className="mt-2 border-t pt-2.5">
              <Label className="text-xs text-muted-foreground">Gap between texts</Label>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {PACE_OPTIONS.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    variant={paceId === p.id ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 rounded-full px-3 text-xs font-normal"
                    onClick={() => setPaceId(p.id)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void push()}
            disabled={busy || !segment.trim() || !message.trim() || sending.length === 0}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {busy
              ? mode === 'send'
                ? 'Sending…'
                : 'Drafting…'
              : mode === 'send'
                ? `Send to ${sending.length.toLocaleString()}`
                : `Draft for ${sending.length.toLocaleString()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
