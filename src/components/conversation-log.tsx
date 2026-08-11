import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  useAddCommNote,
  useDeleteComm,
  useUpdateCommNote,
  type Communication,
} from '@/hooks/use-communications'

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
        <ConversationItem key={c.id} c={c} />
      ))}
    </ul>
  )
}

/** "from a@b.com -> to c@d.com" for an email row, or null for anything else. */
function emailEndpoints(c: Communication): string | null {
  if (c.channel !== 'email') return null
  const raw = (c.raw ?? {}) as { from?: unknown; to?: unknown }
  const from = typeof raw.from === 'string' ? raw.from : null
  const to = typeof raw.to === 'string' ? raw.to : null
  if (!from && !to) return null
  return [from ? `from ${from}` : null, to ? `to ${to}` : null].filter(Boolean).join('  →  ')
}

function ConversationItem({ c }: { c: Communication }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const updateNote = useUpdateCommNote()
  const deleteComm = useDeleteComm()
  // only manual notes are editable — imported calls/transcripts are records
  const editable = c.source === 'manual' && c.channel === 'note'

  const remove = () => {
    if (!window.confirm('Delete this entry from the conversation history?')) return
    deleteComm.mutate(c.id, {
      onSuccess: () => toast.success('Entry deleted'),
      onError: (e) => toast.error(`Could not delete: ${e.message}`),
    })
  }

  const saveEdit = () => {
    const text = draft.trim()
    if (!text) return
    updateNote.mutate(
      { id: c.id, body: text },
      {
        onSuccess: () => {
          setEditing(false)
          toast.success('Note updated')
        },
        onError: (e) => toast.error(`Could not update: ${e.message}`),
      },
    )
  }

  return (
    <li className="group rounded-md border bg-card p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{CHANNEL_ICON[c.channel] ?? '•'}</span>
        <span>{new Date(c.occurred_at).toLocaleDateString()}</span>
        {/* Which way it went. Obvious on a call from context, but an email thread is
            unreadable without it — the same subject appears on both sides. */}
        {c.channel === 'email' && c.direction !== 'unknown' && (
          <Badge
            variant="outline"
            className={
              c.direction === 'inbound'
                ? 'border-emerald-200 bg-emerald-50 text-[10px] uppercase text-emerald-700'
                : 'text-[10px] uppercase'
            }
          >
            {c.direction === 'inbound' ? 'Replied' : 'Sent'}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px] uppercase">{c.source}</Badge>
        {c.disposition && <span>{c.disposition}</span>}
        {(c.tags ?? []).map((t) => (
          <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
        ))}
        <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {editable && !editing && (
            <button
              type="button"
              title="Edit note"
              onClick={() => {
                setDraft(c.body ?? '')
                setEditing(true)
              }}
              className="rounded p-0.5 hover:bg-muted"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            title="Delete entry"
            onClick={remove}
            className="rounded p-0.5 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
      </div>
      {c.subject && <p className="font-medium">{c.subject}</p>}
      {/* The addresses themselves (Alex). A year later "who was this sent to" is the
          first question, and a person can hold several addresses — the thread is only
          trustworthy when it names both ends. */}
      {emailEndpoints(c) && (
        <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {emailEndpoints(c)}
        </p>
      )}
      {editing ? (
        <div className="space-y-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
          <div className="flex gap-2">
            <Button size="sm" onClick={saveEdit} disabled={updateNote.isPending || !draft.trim()}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        c.body && <p className="whitespace-pre-line">{c.body}</p>
      )}
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
