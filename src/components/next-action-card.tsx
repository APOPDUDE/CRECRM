import { useState } from 'react'
import { CalendarClock, Check, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { SidebarSection } from '@/components/board-info-panel'
import { formatDate, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'

interface NextActionCardProps {
  description: string | null
  dueDate: string | null
  pending?: boolean
  /** Persist the next action (both null = cleared / done). */
  onSave: (description: string | null, dueDate: string | null) => void
}

/** "Next action" rail section — the most actionable field, inline-editable from the deal page. */
export function NextActionCard({ description, dueDate, pending, onSave }: NextActionCardProps) {
  const [open, setOpen] = useState(false)
  const [desc, setDesc] = useState('')
  const [due, setDue] = useState('')
  const overdue = isOverdue(dueDate)

  const openEdit = () => {
    setDesc(description ?? '')
    setDue(dueDate ?? '')
    setOpen(true)
  }
  const save = () => {
    onSave(desc.trim() || null, due || null)
    setOpen(false)
  }

  const editForm = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="next-action-desc">What's next?</Label>
        <Textarea
          id="next-action-desc"
          rows={2}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="e.g. Send proposal, follow up on LOI"
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="next-action-due">Due date</Label>
        <Input
          id="next-action-due"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={save} disabled={pending || !desc.trim()}>
          Save
        </Button>
      </div>
    </div>
  )

  return (
    <SidebarSection title="Next action">
      <div
        className={cn(
          'rounded-lg border p-3 text-sm',
          overdue ? 'border-red-200 bg-red-50' : 'bg-card',
        )}
      >
        {description ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{description}</p>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-mr-1 -mt-1 size-6 shrink-0"
                    onClick={openEdit}
                  >
                    <Pencil className="size-3.5" />
                    <span className="sr-only">Edit next action</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72">
                  {editForm}
                </PopoverContent>
              </Popover>
            </div>
            {dueDate && (
              <div
                className={cn(
                  'mt-1 flex items-center gap-1.5 text-xs',
                  overdue ? 'font-medium text-red-700' : 'text-muted-foreground',
                )}
              >
                <CalendarClock className="size-3.5" />
                {overdue ? 'Overdue · ' : ''}
                {formatDate(dueDate)}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => onSave(null, null)}
              disabled={pending}
            >
              <Check className="size-3.5" />
              Mark done
            </Button>
          </>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="w-full" onClick={openEdit}>
                Set next action
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              {editForm}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </SidebarSection>
  )
}
