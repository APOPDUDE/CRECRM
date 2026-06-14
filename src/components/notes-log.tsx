import { useState } from 'react'
import type { FormEvent } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from '@/hooks/use-notes'
import type { Enums } from '@/lib/database.types'
import { formatDate } from '@/lib/dates'

interface NotesLogProps {
  entityType: Enums<'note_entity'>
  entityId: string
}

/** A simple dated notes log — one timestamped note per entry, with inline edit + delete. */
export function NotesLog({ entityType, entityId }: NotesLogProps) {
  const { data: notes = [], isLoading } = useNotes(entityType, entityId)
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  const [body, setBody] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')

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

  const startEdit = (note: { id: string; body: string }) => {
    setEditingId(note.id)
    setEditBody(note.body)
  }

  const saveEdit = () => {
    const text = editBody.trim()
    if (!editingId || !text) return
    updateNote.mutate(
      { id: editingId, entityType, entityId, body: text },
      {
        onSuccess: () => setEditingId(null),
        onError: () => toast.error('Could not update'),
      },
    )
  }

  const handleDelete = (id: string) => {
    deleteNote.mutate(
      { id, entityType, entityId },
      {
        onSuccess: () => toast.success('Deleted'),
        onError: () => toast.error('Could not delete'),
      },
    )
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          data-note-input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note…"
          rows={2}
        />
        <Button
          type="submit"
          size="sm"
          className="w-full"
          disabled={!body.trim() || createNote.isPending}
        >
          {createNote.isPending ? 'Saving…' : 'Log note'}
        </Button>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) =>
            editingId === note.id ? (
              <li key={note.id} className="rounded-md border bg-card p-2.5">
                <div className="space-y-2">
                  <Textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={2}
                    autoFocus
                  />
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={saveEdit}
                      disabled={!editBody.trim() || updateNote.isPending}
                    >
                      {updateNote.isPending ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>
              </li>
            ) : (
              <li key={note.id} className="group rounded-md border bg-card p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(note.created_at)}
                  </span>
                  <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      onClick={() => startEdit(note)}
                    >
                      <Pencil className="size-3.5" />
                      <span className="sr-only">Edit</span>
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(note.id)}
                    >
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap">{note.body}</p>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}
