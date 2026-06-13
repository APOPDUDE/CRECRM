import { useState } from 'react'
import type { FormEvent } from 'react'
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
import { useCreateNote, useNotes, noteKindLabels } from '@/hooks/use-notes'
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

export function NotesLog({ entityType, entityId }: NotesLogProps) {
  const { data: notes = [], isLoading } = useNotes(entityType, entityId)
  const createNote = useCreateNote()
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<NoteKind>('note')

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
          <Select value={kind} onValueChange={(v) => setKind(v as NoteKind)}>
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(noteKindLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border bg-card p-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <Badge variant="outline" className={kindBadgeClass[note.kind]}>
                  {noteKindLabels[note.kind]}
                </Badge>
                <span className="text-xs text-muted-foreground">{formatDate(note.created_at)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{note.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
