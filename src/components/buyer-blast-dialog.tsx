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
import { useAuth } from '@/hooks/use-auth'
import { usePropertyPointSearch, type PropertyPoint } from '@/hooks/use-buyers'
import { useLogBlastPursuits } from '@/hooks/use-matches'
import { formatCurrency, formatSf } from '@/lib/format'
import { renderFor, variantCount } from '@/lib/message-template'
import { cn } from '@/lib/utils'

const BLAST_URL = 'https://n8n.ayxco.com/webhook/buyer-blast'

export type BlastBuyer = {
  clientId: string
  phone: string
  first: string | null
  last: string | null
  company: string | null
  /** token values only this buyer's record can produce — what stops a blast reading as one */
  ctx?: Record<string, string | null>
}

type BlastMode = 'draft' | 'send'

type BlastResult = {
  total?: number
  created?: number
  tagged?: number
  drafted?: number
  tag: string
  /** send mode answers immediately, before any message has gone out */
  queued?: number
}

/** Deal facts the composer can pull in. Everything is optional — a line only appears
 *  when we actually hold the number. */
export type BlastDeal = {
  propertyId: string
  address: string
  city: string | null
  buildingSf: number | null
  landAcres: number | null
  askingPrice: number | null
  url: string | null
}

/**
 * GoHighLevel merge fields. These stay as literal {{...}} in the drafted message —
 * GHL substitutes them per contact at send time, so the text we store is the template,
 * not the finished message. The `|| "…"` fallback is GHL's own syntax and is what keeps
 * a contact with no first name from getting "Hi ,".
 */
export const MERGE_FIELDS: { label: string; token: string }[] = [
  { label: 'First name', token: '{{contact.first_name || "there"}}' },
  { label: 'Company', token: '{{contact.company_name}}' },
  { label: 'What they buy', token: '{{buyer.product}}' },
  { label: 'Their areas', token: '{{buyer.areas}}' },
  { label: 'Their budget', token: '{{buyer.price}}' },
  { label: 'Either/or', token: '{a|b}' },
]

/** Render exactly the way the workflow will, so a preview is proof rather than a guess. */
export function renderMerge(template: string, b: BlastBuyer | undefined): string {
  if (!b) return template
  return renderFor(template, b.clientId || b.phone, {
    'contact.first_name': b.first,
    'contact.last_name': b.last,
    'contact.full_name': [b.first, b.last].filter(Boolean).join(' ') || null,
    'contact.company_name': b.company,
    ...(b.ctx ?? {}),
  })
}

export function composeMessage(deal: BlastDeal | null, dealUrl: string): string {
  if (!deal) return ''
  const where = [deal.address, deal.city].filter(Boolean).join(', ')
  const size = [
    deal.buildingSf ? `±${formatSf(deal.buildingSf)}` : null,
    deal.landAcres ? `${deal.landAcres} AC` : null,
  ]
    .filter(Boolean)
    .join(' on ')
  const price = deal.askingPrice ? formatCurrency(deal.askingPrice) : null
  const psf =
    deal.askingPrice && deal.buildingSf
      ? `$${Math.round(deal.askingPrice / deal.buildingSf)}/SF`
      : null

  const facts = [size, [price, psf].filter(Boolean).join(' · ')].filter(Boolean).join(' — ')
  const link = dealUrl.trim()

  return [
    // References what they told us they buy, and no two recipients read the same words.
    `{Hey|Hi} ${MERGE_FIELDS[0].token} — Alex. You mentioned you're {looking for|after} ` +
      `{{buyer.product || "industrial"}} around {{buyer.areas || "the bay"}}, so this one ` +
      `{came to mind|seemed worth sending}: ${where}.`,
    facts,
    link ? `Details: ${link}` : null,
    '{Worth a look?|Want the numbers?|Any interest?}',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Names a segment, composes the text from a deal, and hands the buyers to GoHighLevel.
 *
 * Nothing sends. Each buyer is created-or-tagged and the exact message is written to their
 * GHL contact as a note, so the blast can be reviewed contact by contact before Alex fires
 * it from the Smart List. The tag is the attribution key — months later a reply still says
 * which campaign produced it.
 */
export function BuyerBlastDialog({
  open,
  onOpenChange,
  buyers,
  noPhoneCount,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  buyers: BlastBuyer[]
  /** buyers in the current view we cannot text */
  noPhoneCount: number
}) {
  const [segment, setSegment] = useState('')
  const [dealQuery, setDealQuery] = useState('')
  const [deal, setDeal] = useState<BlastDeal | null>(null)
  const [dealUrl, setDealUrl] = useState('')
  const [message, setMessage] = useState('')
  const [touched, setTouched] = useState(false)
  const [mode, setMode] = useState<BlastMode>('draft')
  const [busy, setBusy] = useState(false)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const logPursuits = useLogBlastPursuits()
  const { session } = useAuth()
  const userId = session?.user.id
  const results = usePropertyPointSearch(dealQuery)

  useEffect(() => {
    if (!open) return
    setSegment('')
    setDealQuery('')
    setDeal(null)
    setDealUrl('')
    setMessage('')
    setTouched(false)
    setMode('draft')
  }, [open])

  // Retype the message whenever the deal changes, until the user edits it themselves.
  useEffect(() => {
    if (!touched) setMessage(composeMessage(deal, dealUrl))
  }, [deal, dealUrl, touched])

  const pickDeal = async (p: PropertyPoint) => {
    setDealQuery('')
    const { supabase } = await import('@/lib/supabase')
    const [{ data: prop }, { data: comps }] = await Promise.all([
      supabase.from('properties').select('address, city, gross_sf, land_acres').eq('id', p.id).single(),
      supabase
        .from('comps')
        .select('sale_price, as_of_date')
        .eq('property_id', p.id)
        .eq('kind', 'asking')
        .order('as_of_date', { ascending: false })
        .limit(1),
    ])
    setDeal({
      propertyId: p.id,
      address: prop?.address ?? p.address,
      city: prop?.city ?? p.city,
      buildingSf: prop?.gross_sf ?? null,
      landAcres: prop?.land_acres ?? null,
      askingPrice: comps?.[0]?.sale_price ?? null,
      url: null,
    })
  }

  const reach = useMemo(() => buyers.filter((b) => b.phone), [buyers])

  // Preview against someone who HAS a first name where possible — a blank-name buyer
  // would show the fallback and hide what the token actually does.
  const preview = useMemo(() => reach.find((b) => b.first) ?? reach[0], [reach])
  const missingFirstName = useMemo(() => reach.filter((b) => !b.first).length, [reach])
  const variants = useMemo(() => variantCount(message), [message])
  const second = useMemo(() => reach.find((b) => b.clientId !== preview?.clientId), [reach, preview])

  const insertToken = (token: string) => {
    const el = messageRef.current
    setTouched(true)
    if (!el) {
      setMessage((m) => m + token)
      return
    }
    const start = el.selectionStart ?? message.length
    const end = el.selectionEnd ?? start
    const next = message.slice(0, start) + token + message.slice(end)
    setMessage(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const push = async () => {
    if (!segment.trim() || !message.trim() || reach.length === 0) return
    setBusy(true)
    try {
      const res = await fetch(BLAST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segmentName: segment.trim(),
          message: message.trim(),
          dealUrl: dealUrl.trim() || null,
          mode,
          buyers: reach,
        }),
      })
      if (!res.ok) throw new Error(`blast failed (${res.status})`)
      // n8n answers 200 with an EMPTY body when the workflow dies before its Respond node,
      // so a raw res.json() surfaces "Unexpected end of JSON input" and hides the real cause.
      const raw = await res.text()
      if (!raw.trim()) {
        throw new Error('the automation errored before it finished — check the n8n execution log')
      }
      let r: BlastResult
      try {
        r = JSON.parse(raw) as BlastResult
      } catch {
        throw new Error(`unexpected reply from the automation: ${raw.slice(0, 120)}`)
      }
      if (mode === 'send') {
        const n = r.queued ?? reach.length
        // The pursuit is the record of "this buyer was shown this property". Without it the
        // blast leaves no trace to mark Touring or Passed against later.
        let logged = 0
        if (deal) {
          try {
            const res2 = await logPursuits.mutateAsync({
              propertyId: deal.propertyId,
              clientIds: buyers.filter((b) => b.phone).map((b) => b.clientId),
              note: `Texted in "${segment.trim()}" on ${new Date().toISOString().slice(0, 10)}.`,
              ownerId: userId!,
            })
            logged = res2.added
          } catch {
            toast.warning('Texts queued, but the deal was not added to their lists', {
              description: 'Add it by hand from each buyer’s board, or tell Claude to retry.',
            })
          }
        }
        // 45-120s apart, so quote the middle of the range rather than a number that will be wrong.
        const mins = Math.round((n * 82.5) / 60)
        toast.success(`Queued ${n} iMessage${n === 1 ? '' : 's'}`, {
          description:
            `Going out over roughly the next ${mins} minute${mins === 1 ? '' : 's'}, 45s to 2min apart. ` +
            (deal
              ? `${logged} buyer${logged === 1 ? '' : 's'} now have ${deal.address} inquiring on their board.`
              : `Tag: ${r.tag}.`),
        })
      } else {
        const n = r.drafted ?? reach.length
        toast.success(`Drafted for ${n} buyer${n === 1 ? '' : 's'}`, {
          description: `${r.created} created, ${r.tagged} already in GoHighLevel. Tag: ${r.tag}. Nothing was sent.`,
        })
      }
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
          <DialogTitle>Text these buyers</DialogTitle>
          <DialogDescription>
            The {reach.length.toLocaleString()} buyer{reach.length === 1 ? '' : 's'} you ticked get
            tagged into a segment in GoHighLevel and the message is saved on each contact as a
            draft. Nothing sends — you fire it from the Smart List when it reads right.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="blast-segment">Segment name</Label>
          <Input
            id="blast-segment"
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            placeholder="Pinellas small bay — Aug"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Becomes the tag <code>blast-{segment.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '…'}</code>{' '}
            in GoHighLevel. Filter a Smart List on it, and a reply months from now still tells you
            which campaign it came from.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="blast-deal">Deal</Label>
          {deal ? (
            <div className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm">
              <span>
                {deal.address}
                {deal.city ? `, ${deal.city}` : ''}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setDeal(null)}>
                Change
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Input
                id="blast-deal"
                value={dealQuery}
                onChange={(e) => setDealQuery(e.target.value)}
                placeholder="Search a property address…"
              />
              {dealQuery.trim().length >= 3 && (results.data?.length ?? 0) > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                  {results.data!.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => void pickDeal(p)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      {p.address}
                      <span className="text-muted-foreground">{p.city ? ` · ${p.city}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="blast-url">Link</Label>
          <Input
            id="blast-url"
            value={dealUrl}
            onChange={(e) => setDealUrl(e.target.value)}
            placeholder="https://www.loopnet.com/Listing/…"
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="blast-message">Message</Label>
            <div className="flex flex-wrap gap-1">
              {MERGE_FIELDS.map((f) => (
                <Button
                  key={f.token}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs font-normal"
                  onClick={() => insertToken(f.token)}
                >
                  + {f.label}
                </Button>
              ))}
            </div>
          </div>
          <Textarea
            id="blast-message"
            ref={messageRef}
            rows={6}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value)
              setTouched(true)
            }}
            placeholder="Pick a deal above and this writes itself — or type your own."
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">{message.length} characters</span>
            <span className="tabular-nums">
              {variants === 1
                ? 'every recipient gets identical wording'
                : `${variants.toLocaleString()} wordings in rotation`}
            </span>
          </div>
          {variants === 1 && reach.length > 3 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              Identical text to {reach.length} numbers is what gets a line flagged. Add a choice
              like <code>{'{Hey|Hi}'}</code>, and reference something only they would know — the
              buttons above insert both.
            </p>
          )}

          {/* What one real recipient actually sees. GHL fills these in at send time; this
              renders the same substitution locally so the tokens are not taken on faith. */}
          {message.trim() && preview && (
            <div className="space-y-2">
              {[preview, second].filter(Boolean).map((b, i) => (
                <div key={b!.clientId || i} className="rounded-md border bg-muted/40 p-2.5">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    As {[b!.first, b!.last].filter(Boolean).join(' ') || b!.company || 'this buyer'}{' '}
                    receives it
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{renderMerge(message, b!)}</p>
                </div>
              ))}
            </div>
          )}

          {message.includes('{{contact.first_name') && missingFirstName > 0 && (
            <p className="text-xs text-muted-foreground">
              {missingFirstName} of the {reach.length} ticked{' '}
              {missingFirstName === 1 ? 'has' : 'have'} no first name on file, so{' '}
              {missingFirstName === 1 ? 'that one falls' : 'those fall'} back to the wording after{' '}
              <code>||</code>.
            </p>
          )}
        </div>

        {noPhoneCount > 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
            {noPhoneCount.toLocaleString()} buyer{noPhoneCount === 1 ? '' : 's'} in this view{' '}
            {noPhoneCount === 1 ? 'has' : 'have'} no phone number and cannot be texted.
          </p>
        )}

        <div className="space-y-1.5 rounded-lg border p-3">
          {(
            [
              ['draft', 'Draft only', 'Writes the text on each contact as a note. Nothing leaves.'],
              [
                'send',
                'Send now over iMessage',
                `Goes out through Blooio, 5 to 15 minutes apart — about ${
                  Math.round(reach.length * 10) >= 90
                    ? `${(Math.round(reach.length * 10) / 60).toFixed(1)} hours`
                    : `${Math.round(reach.length * 10)} minutes`
                } for ${reach.length}.`,
              ],
            ] as [BlastMode, string, string][]
          ).map(([v, label, hint]) => (
            <label key={v} className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="radio"
                name="blast-mode"
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
            disabled={busy || !segment.trim() || !message.trim() || reach.length === 0}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {busy
              ? mode === 'send'
                ? 'Sending…'
                : 'Drafting…'
              : mode === 'send'
                ? `Send to ${reach.length.toLocaleString()}`
                : `Draft for ${reach.length.toLocaleString()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
