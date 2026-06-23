import { useState } from 'react'
import type { FormEvent } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from '@/hooks/use-notes'
import type { ParentType } from '@/hooks/use-notes'
import { useCreateTask } from '@/hooks/use-tasks'
import { useAuth } from '@/hooks/use-auth'
import { formatDate } from '@/lib/dates'

const parentColumn = (t: ParentType) =>
  t === 'client' ? 'client_id' : t === 'listing' ? 'listing_id' : 'pursuit_id'

interface NotesLogProps {
  parentType: ParentType
  parentId: string
  /** Hide the "add a note" composer (e.g. when an Add button already lives elsewhere). */
  showComposer?: boolean
}

/** A simple dated notes log — one timestamped note per entry, with inline edit + delete. */
export function NotesLog({ parentType, parentId, showComposer = true }: NotesLogProps) {
  const { session } = useAuth()
  const { data: notes = [], isLoading } = useNotes(parentType, parentId)
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()
  const createTask = useCreateTask()

  const [body, setBody] = useState('')
  const [withTask, setWithTask] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDate, setTaskDate] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')

  const resetComposer = () => {
    setBody('')
    setWithTask(false)
    setTaskTitle('')
    setTaskDate('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    try {
      // note first so the task can link to it
      const n = await createNote.mutateAsync({ parentType, parentId, body: text })
      if (withTask && taskTitle.trim() && session?.user.id) {
        await createTask.mutateAsync({
          owner_id: session.user.id,
          title: taskTitle.trim(),
          kind: 'general',
          due_date: taskDate || null,
          note_id: n.id,
          [parentColumn(parentType)]: parentId,
          status: 'open',
          auto_generated: false,
        })
      }
      resetComposer()
    } catch {
      toast.error('Could not save note')
    }
  }

  const startEdit = (note: { id: string; body: string }) => {
    setEditingId(note.id)
    setEditBody(note.body)
  }

  const saveEdit = () => {
    const text = editBody.trim()
    if (!editingId || !text) return
    updateNote.mutate(
      { id: editingId, parentType, parentId, body: text },
      {
        onSuccess: () => setEditingId(null),
        onError: () => toast.error('Could not update'),
      },
    )
  }

  const handleDelete = (id: string) => {
    deleteNote.mutate(
      { id, parentType, parentId },
      {
        onSuccess: () => toast.success('Deleted'),
        onError: () => toast.error('Could not delete'),
      },
    )
  }

  return (
    <div className="space-y-3">
      {showComposer && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <Textarea
            data-note-input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note…"
            rows={2}
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={withTask} onCheckedChange={(v) => setWithTask(v === true)} />
            Add a task?
          </label>
          {withTask && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Task title"
              />
              <Input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} />
            </div>
          )}
          <Button
            type="submit"
            size="sm"
            className="w-full"
            disabled={!body.trim() || createNote.isPending || createTask.isPending}
          >
            {createNote.isPending || createTask.isPending ? 'Saving…' : 'Log note'}
          </Button>
        </form>
      )}

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
