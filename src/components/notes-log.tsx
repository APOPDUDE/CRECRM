import { useState } from 'react'
import type { FormEvent } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useUpdateNote,
  noteKindLabels,
} from '@/hooks/use-notes'
import type { Enums } from '@/lib/database.types'
import { formatDate } from '@/lib/dates'

type NoteKind = Enums<'note_kind'>

interface NotesLogProps {
  entityType: Enums<'note_entity'>
  entityId: string
}

const kindBadgeClass: Record<NoteKind, string> = {
  note: 'bg-gray-50 text-gray-600 border-gray-200',
  call: 'bg-blue-50 text-blue-700 border-blue-200',
  text: 'bg-teal-50 text-teal-700 border-teal-200',
  email: 'bg-violet-50 text-violet-700 border-violet-200',
  meeting: 'bg-amber-50 text-amber-700 border-amber-200',
}

function KindSelect({
  value,
  onChange,
}: {
  value: NoteKind
  onChange: (v: NoteKind) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as NoteKind)}>
      <SelectTrigger size="sm" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(noteKindLabels).map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function NotesLog({ entityType, entityId }: NotesLogProps) {
  const { data: notes = [], isLoading } = useNotes(entityType, entityId)
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  const [body, setBody] = useState('')
  const [kind, setKind] = useState<NoteKind>('note')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [editKind, setEditKind] = useState<NoteKind>('note')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    createNote.mutate(
      { entityType, entityId, body: text, kind },
      {
        onSuccess: () => setBody(''),
        onError: () => toast.error('Could not save note'),
      },
    )
  }

  const startEdit = (note: { id: string; body: string; kind: NoteKind }) => {
    setEditingId(note.id)
    setEditBody(note.body)
    setEditKind(note.kind)
  }

  const saveEdit = () => {
    const text = editBody.trim()
    if (!editingId || !text) return
    updateNote.mutate(
      { id: editingId, entityType, entityId, body: text, kind: editKind },
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
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Log a note, call, text, email…"
          rows={2}
        />
        <div className="flex items-center justify-between gap-2">
          <KindSelect value={kind} onChange={setKind} />
          <Button type="submit" size="sm" disabled={!body.trim() || createNote.isPending}>
            {createNote.isPending ? 'Saving…' : 'Log'}
          </Button>
        </div>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
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
                  <div className="flex items-center justify-between gap-2">
                    <KindSelect value={editKind} onChange={setEditKind} />
                    <div className="flex gap-1">
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
                </div>
              </li>
            ) : (
              <li key={note.id} className="group rounded-md border bg-card p-2.5">
                <div className="mb-1 flex items-center gap-1.5">
                  <Badge variant="outline" className={kindBadgeClass[note.kind]}>
                    {noteKindLabels[note.kind]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(note.created_at)}</span>
                  <div className="ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
