import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowUpRight, Building2, Plus, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ContactActions } from '@/components/contact-actions'
import { InlineEditField } from '@/components/inline-edit-field'
import { contactNameOf } from '@/hooks/use-contacts'
import {
  useAddProspectProperty,
  useConvertProspect,
  useRemoveProspectProperty,
  useUpdateProspect,
  type ProspectWithRelations,
} from '@/hooks/use-prospects'
import { usePropertySearch } from '@/hooks/use-listing-parcels'
import { useCreateTask, useTasks, useToggleTask } from '@/hooks/use-tasks'
import { formatDate, isOverdue } from '@/lib/dates'
import type { Enums } from '@/lib/database.types'
import { cn } from '@/lib/utils'

interface ProspectSlideOverProps {
  prospect: ProspectWithRelations | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Prospect detail: description, attached properties, tasks, and the push-to-pipeline actions. */
export function ProspectSlideOver({ prospect, open, onOpenChange }: ProspectSlideOverProps) {
  const navigate = useNavigate()
  const updateProspect = useUpdateProspect()
  const addProperty = useAddProspectProperty()
  const removeProperty = useRemoveProspectProperty()
  const convert = useConvertProspect()
  const createTask = useCreateTask()
  const toggleTask = useToggleTask()
  const { data: allTasks = [] } = useTasks()

  const [propSearch, setPropSearch] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDue, setTaskDue] = useState('')
  const [pendingPush, setPendingPush] = useState<'listing' | 'client' | null>(null)
  const [dealType, setDealType] = useState<Enums<'deal_type'>>('lease')
  const { data: propResults = [] } = usePropertySearch(propSearch, '')

  if (!prospect) return null
  const p = prospect

  const who = p.contact ? contactNameOf(p.contact) : (p.company?.name ?? 'Prospect')
  const tasks = allTasks.filter((t) => t.prospect_id === p.id && t.status === 'open')
  const attachedIds = new Set(p.properties.map((x) => x.property_id))
  const suggestions = propResults.filter((r) => !attachedIds.has(r.id)).slice(0, 5)

  const saveDescription = async (v: string | number | boolean | null) => {
    try {
      await updateProspect.mutateAsync({ id: p.id, description: v == null ? null : String(v) })
      toast.success('Description saved')
    } catch {
      toast.error('Could not save description')
    }
  }

  const handleAddTask = (e: FormEvent) => {
    e.preventDefault()
    if (!taskTitle.trim()) return
    createTask.mutate(
      {
        owner_id: p.owner_id,
        prospect_id: p.id,
        contact_id: p.contact_id,
        title: taskTitle.trim(),
        kind: 'general',
        status: 'open',
        due_date: taskDue || null,
      },
      {
        onSuccess: () => {
          setTaskTitle('')
          setTaskDue('')
        },
        onError: () => toast.error('Could not add task'),
      },
    )
  }

  const handleConvert = () => {
    if (!pendingPush) return
    convert.mutate(
      { prospectId: p.id, target: pendingPush, dealType },
      {
        onSuccess: (result) => {
          setPendingPush(null)
          onOpenChange(false)
          if (result.target === 'client' && result.client_id) {
            toast.success('Pushed to tenant rep')
            navigate(`/tenant-rep/${result.client_id}`)
          } else {
            toast.success(
              `Pushed to landlord rep — ${result.listing_ids.length} ${result.listing_ids.length === 1 ? 'listing' : 'listings'} created`,
            )
            navigate('/repping')
          }
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not push the prospect'),
      },
    )
  }

  const markDead = () => {
    updateProspect.mutate(
      { id: p.id, status: 'dead' },
      {
        onSuccess: () => {
          toast.success('Prospect marked dead')
          onOpenChange(false)
        },
        onError: () => toast.error('Could not update prospect'),
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{who}</SheetTitle>
          <SheetDescription>
            {p.company?.name && p.contact ? `${p.company.name} · ` : ''}
            Prospect since {formatDate(p.created_at)}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-4">
          {p.contact && (p.contact.phone || p.contact.email) && (
            <div className="-mt-1">
              <ContactActions phone={p.contact.phone} email={p.contact.email} />
            </div>
          )}

          <div className="rounded-lg border p-3">
            <InlineEditField
              label="Description"
              value={p.description}
              kind="text"
              multiline
              onSave={saveDescription}
            />
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground">Properties</p>
            {p.properties.length === 0 && (
              <p className="text-sm text-muted-foreground">None attached yet.</p>
            )}
            {p.properties.map((pp) => (
              <div key={pp.property_id} className="flex items-center gap-2 text-sm">
                <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:text-primary hover:underline"
                  onClick={() => {
                    onOpenChange(false)
                    navigate(`/properties/${pp.property_id}`)
                  }}
                >
                  {pp.property?.address ?? 'Property'}
                  {pp.property?.city ? `, ${pp.property.city}` : ''}
                </button>
                <button
                  type="button"
                  aria-label="Detach property"
                  onClick={() => removeProperty.mutate({ prospectId: p.id, propertyId: pp.property_id })}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <Input
              value={propSearch}
              onChange={(e) => setPropSearch(e.target.value)}
              placeholder="Attach a property — search by address…"
              autoComplete="off"
              className="h-8"
            />
            {suggestions.length > 0 && (
              <ul className="divide-y overflow-hidden rounded-md border">
                {suggestions.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 p-2 text-left text-sm hover:bg-accent/50"
                      onClick={() => {
                        addProperty.mutate({ prospectId: p.id, propertyId: r.id })
                        setPropSearch('')
                      }}
                    >
                      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {r.address}
                        {r.city ? `, ${r.city}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground">Tasks</p>
            {tasks.length === 0 && <p className="text-sm text-muted-foreground">No open tasks.</p>}
            {tasks.map((t) => {
              const overdue = isOverdue(t.due_date)
              return (
                <div key={t.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={false}
                    disabled={toggleTask.isPending}
                    onCheckedChange={(v) =>
                      v === true && toggleTask.mutate({ id: t.id, status: 'done' })
                    }
                    aria-label="Mark task done"
                  />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  {t.due_date && (
                    <span
                      className={cn(
                        'shrink-0 text-xs tabular-nums',
                        overdue ? 'font-medium text-red-600' : 'text-muted-foreground',
                      )}
                    >
                      {formatDate(t.due_date)}
                    </span>
                  )}
                </div>
              )
            })}
            <form onSubmit={handleAddTask} className="flex items-center gap-1.5">
              <Input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Add a task…"
                className="h-8 min-w-0 flex-1"
              />
              <Input
                type="date"
                value={taskDue}
                onChange={(e) => setTaskDue(e.target.value)}
                aria-label="Due date"
                className="h-8 w-32 shrink-0"
              />
              <Button type="submit" size="sm" variant="outline" className="h-8 shrink-0" disabled={!taskTitle.trim() || createTask.isPending}>
                Add
              </Button>
            </form>
          </div>

          {p.status === 'open' ? (
            pendingPush ? (
              <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <p className="text-sm font-medium">
                  {pendingPush === 'client'
                    ? `Push ${who} to tenant rep?`
                    : `Push to landlord rep — one listing per property (${p.properties.length})?`}
                </p>
                <div className="flex items-center gap-2">
                  <Select value={dealType} onValueChange={(v) => setDealType(v as Enums<'deal_type'>)}>
                    <SelectTrigger className="h-8 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lease">Lease</SelectItem>
                      <SelectItem value="sale">Sale</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="h-8" onClick={handleConvert} disabled={convert.isPending}>
                    {convert.isPending ? 'Pushing…' : 'Confirm'}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => setPendingPush(null)}>
                    Cancel
                  </Button>
                </div>
                {pendingPush === 'listing' && p.properties.length === 0 && (
                  <p className="text-xs text-amber-700">Attach at least one property first.</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Push to a pipeline</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setPendingPush('listing')}>
                    Landlord rep
                    <ArrowUpRight className="size-4" />
                  </Button>
                  <Button variant="outline" onClick={() => setPendingPush('client')} disabled={!p.contact_id}>
                    Tenant rep
                    <ArrowUpRight className="size-4" />
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive"
                  onClick={markDead}
                >
                  <XCircle className="size-4" />
                  Mark dead
                </Button>
              </div>
            )
          ) : (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={p.status === 'converted' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-600'}>
                {p.status === 'converted'
                  ? `Converted${p.converted_at ? ` ${format(new Date(p.converted_at), 'MMM d')}` : ''}`
                  : 'Dead'}
              </Badge>
              {p.status === 'dead' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateProspect.mutate({ id: p.id, status: 'open' })}
                >
                  Reopen
                </Button>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
