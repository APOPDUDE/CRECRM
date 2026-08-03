import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAddCommNote, type Communication } from '@/hooks/use-communications'

const CHANNEL_ICON: Record<string, string> = {
  call: '📞',
  sms: '💬',
  email: '✉️',
  note: '📝',
  meeting: '🤝',
  other: '•',
}

/**
 * The conversation history behind a contact/owner: every imported call, note and
 * transcript (HubSpot, Terrakotta, GHL) plus manual notes, newest first.
 */
export function ConversationLog({ comms }: { comms: Communication[] }) {
  if (comms.length === 0) {
    return <p className="text-sm text-muted-foreground">No conversations logged yet.</p>
  }
  return (
    <ul className="space-y-3">
      {comms.map((c) => (
        <li key={c.id} className="rounded-md border bg-card p-3 text-sm">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{CHANNEL_ICON[c.channel] ?? '•'}</span>
            <span>{new Date(c.occurred_at).toLocaleDateString()}</span>
            <Badge variant="outline" className="text-[10px] uppercase">{c.source}</Badge>
            {c.disposition && <span>{c.disposition}</span>}
            {(c.tags ?? []).map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
            ))}
          </div>
          {c.subject && <p className="font-medium">{c.subject}</p>}
          {c.body && <p className="whitespace-pre-line">{c.body}</p>}
          {c.transcript && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Call transcript
              </summary>
              <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                {c.transcript}
              </p>
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Composer for a manual note; caller supplies the identity/context ids. */
export function AddNoteBox({
  contactId,
  ownerId,
  propertyId,
}: {
  contactId: string | null
  ownerId?: string | null
  propertyId?: string | null
}) {
  const [body, setBody] = useState('')
  const addNote = useAddCommNote()

  if (!contactId) {
    return (
      <p className="text-xs text-muted-foreground">
        Add a contact to this owner before taking notes (notes attach to a person).
      </p>
    )
  }

  const save = () => {
    const text = body.trim()
    if (!text) return
    addNote.mutate(
      { contact_id: contactId, owner_id: ownerId ?? null, property_id: propertyId ?? null, body: text },
      {
        onSuccess: () => {
          setBody('')
          toast.success('Note saved')
        },
        onError: (e) => toast.error(`Could not save note: ${e.message}`),
      },
    )
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note — call outcome, context, next step…"
        rows={2}
      />
      <Button size="sm" onClick={save} disabled={addNote.isPending || !body.trim()}>
        Save note
      </Button>
    </div>
  )
}
