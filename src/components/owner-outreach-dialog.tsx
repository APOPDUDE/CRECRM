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
import { renderFor, variantCount } from '@/lib/message-template'
import { cn } from '@/lib/utils'

const BLAST_URL = 'https://n8n.ayxco.com/webhook/buyer-blast'

export type OwnerRecipient = {
  recipientId: string
  phone: string
  first: string | null
  last: string | null
  company: string | null
  /** what makes the message theirs: the building they own */
  ctx: Record<string, string | null>
  /** GHL custom fields, so the owner record stays as rich as the tag-only push made it */
  cf?: { id: string; field_value: string }[]
}

type Mode = 'draft' | 'send'

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
  skippedCount,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  recipients: OwnerRecipient[]
  /** owners in view with no reachable phone */
  skippedCount: number
}) {
  const [segment, setSegment] = useState('')
  const [templateId, setTemplateId] = useState(OWNER_TEMPLATES[0].id)
  const [message, setMessage] = useState(OWNER_TEMPLATES[0].body)
  const [tenant, setTenant] = useState('')
  const [comp, setComp] = useState('')
  const [mode, setMode] = useState<Mode>('draft')
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
  const shown = recipients.slice(0, 2)
  const needsTenant = message.includes('{{campaign.tenant') && !tenant.trim()
  const needsComp = message.includes('{{campaign.comp') && !comp.trim()

  const push = async () => {
    if (!segment.trim() || !message.trim() || recipients.length === 0) return
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
          recipients: recipients.map((r) => ({
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
      const n = r.queued ?? r.drafted ?? recipients.length
      toast.success(
        mode === 'send' ? `Queued ${n} iMessage${n === 1 ? '' : 's'}` : `Drafted for ${n} owner${n === 1 ? '' : 's'}`,
        {
          description:
            mode === 'send'
              ? `Going out 45s to 2min apart. Tag: ${r.tag}.`
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
            {recipients.length.toLocaleString()} owner{recipients.length === 1 ? '' : 's'} in this
            view get tagged in GoHighLevel and the message written on their contact. Everything goes
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

        {skippedCount > 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
            {skippedCount.toLocaleString()} owner{skippedCount === 1 ? '' : 's'} in this view have no
            reachable phone and cannot be messaged.
          </p>
        )}

        <div className="space-y-1.5 rounded-lg border p-3">
          {(
            [
              ['draft', 'Draft only', 'Writes the text on each contact as a note. Nothing leaves.'],
              ['send', 'Send now over iMessage', 'Goes out through Blooio, 45 seconds to 2 minutes apart.'],
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void push()}
            disabled={busy || !segment.trim() || !message.trim() || recipients.length === 0}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {busy
              ? mode === 'send'
                ? 'Sending…'
                : 'Drafting…'
              : mode === 'send'
                ? `Send to ${recipients.length.toLocaleString()}`
                : `Draft for ${recipients.length.toLocaleString()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
