import { useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useCreateNote, useNotes } from '@/hooks/use-notes'
import type { Enums } from '@/lib/database.types'
import { formatDate } from '@/lib/dates'

interface NotesLogProps {
  entityType: Enums<'note_entity'>
  entityId: string
}

export function NotesLog({ entityType, entityId }: NotesLogProps) {
  const { data: notes = [], isLoading } = useNotes(entityType, entityId)
  const createNote = useCreateNote()
  const [body, setBody] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    createNote.mutate(
      { entityType, entityId, body: text },
      {
        onSuccess: () => setBody(''),
        onError: () => toast.error('Could not save note'),
      },
    )
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note…"
          rows={2}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!body.trim() || createNote.isPending}>
            {createNote.isPending ? 'Saving…' : 'Add note'}
          </Button>
        </div>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border bg-card p-2.5">
              <p className="text-sm whitespace-pre-wrap">{note.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatDate(note.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
