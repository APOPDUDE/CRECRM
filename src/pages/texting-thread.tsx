import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowLeft, Check, Loader2, Minus, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  useThreadContext,
  useVaConfirmOwner,
  useVaNotInterested,
  useVaSendReply,
  useVaWrongPerson,
  type ThreadCandidate,
  type ThreadMessage,
} from '@/hooks/use-texting'
import { formatPhone } from '@/lib/format'
import { cn } from '@/lib/utils'

/** "Robert Smith Jr" -> { first: "Robert", last: "Smith Jr" } — first word, then the rest. */
function splitName(name: string | null | undefined): { first: string; last: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

function MessageBubble({ message }: { message: ThreadMessage }) {
  const inbound = message.direction === 'inbound'
  const receipt = message.read_at ? 'Read' : message.delivered_at ? 'Delivered' : null
  return (
    <div
      className={cn(
        'max-w-[80%] rounded-2xl px-3 py-2',
        inbound
          ? 'self-start rounded-bl-sm bg-muted'
          : 'self-end rounded-br-sm bg-primary text-primary-foreground',
      )}
    >
      <p className="whitespace-pre-wrap text-sm">{message.body ?? ''}</p>
      <p
        className={cn(
          'mt-0.5 text-[10px]',
          inbound ? 'text-muted-foreground' : 'text-primary-foreground/70',
        )}
      >
        {format(new Date(message.created_at), 'MMM d, h:mm a')}
        {message.protocol !== 'unknown' ? ` · ${message.protocol.toUpperCase()}` : ''}
        {!inbound && receipt ? ` · ${receipt}` : ''}
      </p>
    </div>
  )
}

/**
 * The thread console: transcript + composer + the three verdicts. Everything renders from
 * one va_thread_context call; every action invalidates it (and the queue) on success.
 */
export function TextingThreadPage() {
  const { phone } = useParams<{ phone: string }>()
  const navigate = useNavigate()
  const { data: ctx, isLoading } = useThreadContext(phone)

  const [body, setBody] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [wrongOpen, setWrongOpen] = useState(false)
  const [notInterestedOpen, setNotInterestedOpen] = useState(false)

  const sendReply = useVaSendReply()
  const confirmOwner = useVaConfirmOwner()
  const wrongPerson = useVaWrongPerson()
  const notInterested = useVaNotInterested()

  // Confirmed-owner dialog state. Auto-pick when there is exactly one identity;
  // a shared number (>1) forces a conscious pick before the submit enables.
  const candidates = useMemo(() => ctx?.candidates ?? [], [ctx])
  const [targetId, setTargetId] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  useEffect(() => {
    if (!confirmOpen) return
    const initial = candidates.length === 1 ? candidates[0] : null
    setTargetId(initial?.target_id ?? null)
    const { first, last } = splitName(initial?.name)
    setFirstName(first)
    setLastName(last)
  }, [confirmOpen, candidates])

  const pickCandidate = (candidate: ThreadCandidate) => {
    setTargetId(candidate.target_id)
    const { first, last } = splitName(candidate.name)
    setFirstName(first)
    setLastName(last)
  }

  const canReply = !!ctx?.thread && !!ctx.thread.last_inbound_at
  const displayPhone = formatPhone(ctx?.phone ?? phone) ?? phone

  const handleSend = async () => {
    if (!phone || !body.trim()) return
    try {
      await sendReply.mutateAsync({ phone, body: body.trim() })
      setBody('')
      toast.success('Reply queued to send.')
    } catch (err) {
      toast.error(errMessage(err, 'The reply could not be sent.'))
    }
  }

  const handleConfirmOwner = async () => {
    if (!phone || !targetId) return
    try {
      await confirmOwner.mutateAsync({
        phone,
        target_id: targetId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      })
      setConfirmOpen(false)
      toast.success('Owner confirmed — contact verified.')
      navigate('/texting')
    } catch (err) {
      toast.error(errMessage(err, 'The confirmation failed.'))
    }
  }

  const handleWrongPerson = async () => {
    if (!phone) return
    try {
      await wrongPerson.mutateAsync(phone)
      setWrongOpen(false)
      toast.success('Marked wrong person — number suppressed.')
      navigate('/texting')
    } catch (err) {
      toast.error(errMessage(err, 'The update failed.'))
    }
  }

  const handleNotInterested = async () => {
    if (!phone) return
    try {
      await notInterested.mutateAsync(phone)
      setNotInterestedOpen(false)
      toast.success('Marked not interested — held for 12 months.')
      navigate('/texting')
    } catch (err) {
      toast.error(errMessage(err, 'The update failed.'))
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const primary = candidates[0]
  const title = primary?.name ?? primary?.company_name ?? displayPhone
  const subtitle = [
    title !== displayPhone ? displayPhone : null,
    primary?.company_name && primary.company_name !== title ? primary.company_name : null,
    primary?.property_address,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="space-y-4">
      {/* Identity header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="icon" asChild className="mt-0.5 shrink-0">
            <Link to="/texting">
              <ArrowLeft className="size-4" />
              <span className="sr-only">Back to replies</span>
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{title}</h1>
              {candidates.length > 1 ? (
                <Badge variant="secondary">{candidates.length} possible identities</Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {subtitle || (primary ? '' : 'No matched identity')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={!candidates.length}>
            <Check className="size-4" /> Confirmed owner
          </Button>
          <Button size="sm" variant="outline" onClick={() => setWrongOpen(true)}>
            <X className="size-4" /> Wrong person
          </Button>
          <Button size="sm" variant="outline" onClick={() => setNotInterestedOpen(true)}>
            <Minus className="size-4" /> Not interested
          </Button>
        </div>
      </div>

      {/* Transcript */}
      <div className="flex min-h-48 flex-col gap-2 rounded-lg border bg-background p-4">
        {ctx?.messages.length ? (
          ctx.messages.map((m) => <MessageBubble key={m.id} message={m} />)
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={canReply ? 'Type a reply…' : 'Replies unlock once they text back'}
          disabled={!canReply || sendReply.isPending}
          rows={2}
          className="flex-1 resize-none"
        />
        {canReply ? (
          <Button
            onClick={handleSend}
            disabled={!body.trim() || sendReply.isPending}
            className="shrink-0"
          >
            {sendReply.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A disabled button swallows pointer events — the span carries the tooltip. */}
              <span tabIndex={0}>
                <Button disabled className="pointer-events-none shrink-0">
                  <Send className="size-4" /> Send
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Replies unlock once they text back</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Confirmed owner */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm owner</DialogTitle>
            <DialogDescription>
              {candidates.length > 1
                ? 'This number matches more than one identity — pick who texted back.'
                : 'Verifies this contact and links them to their property.'}
            </DialogDescription>
          </DialogHeader>

          {candidates.length > 1 ? (
            <div className="space-y-1.5">
              {candidates.map((c) => (
                <label
                  key={c.target_id}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors',
                    targetId === c.target_id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                  )}
                >
                  <input
                    type="radio"
                    name="candidate"
                    className="mt-1 accent-primary"
                    checked={targetId === c.target_id}
                    onChange={() => pickCandidate(c)}
                  />
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{c.name ?? 'Unnamed'}</span>
                    <span className="block text-muted-foreground">
                      {[c.company_name, c.property_address].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="confirm-first">First name</Label>
              <Input
                id="confirm-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-last">Last name</Label>
              <Input
                id="confirm-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={confirmOwner.isPending}>
              Cancel
            </Button>
            <Button onClick={handleConfirmOwner} disabled={!targetId || confirmOwner.isPending}>
              {confirmOwner.isPending ? 'Confirming…' : 'Confirm owner'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wrong person */}
      <Dialog open={wrongOpen} onOpenChange={setWrongOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Wrong person?</DialogTitle>
            <DialogDescription>
              Marks {displayPhone} as a wrong number and permanently stops texting it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWrongOpen(false)} disabled={wrongPerson.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleWrongPerson} disabled={wrongPerson.isPending}>
              {wrongPerson.isPending ? 'Marking…' : 'Wrong person'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Not interested */}
      <Dialog open={notInterestedOpen} onOpenChange={setNotInterestedOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Not interested?</DialogTitle>
            <DialogDescription>
              Holds {displayPhone} out of every text and call run for 12 months.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNotInterestedOpen(false)}
              disabled={notInterested.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleNotInterested} disabled={notInterested.isPending}>
              {notInterested.isPending ? 'Marking…' : 'Not interested'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default TextingThreadPage
