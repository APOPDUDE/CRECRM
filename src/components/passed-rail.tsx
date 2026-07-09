import { useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { usePersistentState } from '@/hooks/use-persistent-state'

export interface PassedRailItem {
  id: string
  title: string
  subtitle?: string | null
}

interface PassedRailProps {
  /** Pursuits in the 'passed' stage — the rail hides itself when empty. */
  items: PassedRailItem[]
  /** Put a deal back in play (restores it to the first pipeline column). */
  onRestore: (id: string) => void
  /** Permanently delete the pursuit — confirmed inside the rail. */
  onDelete: (id: string) => void
  deletePending?: boolean
}

/**
 * The closed-off column on the LEFT of a pursuit board: every deal that was passed on
 * (including anything removed from the board — removals are soft now). Collapsed to a
 * slim strip by default; expand to restore a deal or delete it for good.
 */
export function PassedRail({ items, onRestore, onDelete, deletePending }: PassedRailProps) {
  const [open, setOpen] = usePersistentState('passed-rail-open', false)
  const [deleting, setDeleting] = useState<PassedRailItem | null>(null)

  if (items.length === 0) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Show passed deals"
        className="flex w-9 shrink-0 flex-col items-center gap-2 self-stretch rounded-xl border bg-muted/40 py-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronRight className="size-4" />
        <span className="text-xs font-medium [writing-mode:vertical-rl]">
          Passed · {items.length}
        </span>
      </button>
    )
  }

  return (
    <div className="flex w-56 shrink-0 flex-col self-stretch overflow-hidden rounded-xl border bg-muted/40">
      <div className="flex items-center gap-2 border-b bg-background/60 px-3 py-2">
        <span className="flex-1 text-sm font-medium">Passed</span>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground tabular-nums shadow-sm">
          {items.length}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => setOpen(false)}
          aria-label="Collapse passed rail"
        >
          <ChevronLeft className="size-4" />
        </Button>
      </div>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border bg-card p-2 shadow-sm">
            <div className="truncate text-sm font-medium">{item.title}</div>
            {item.subtitle && (
              <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>
            )}
            <div className="mt-1.5 flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 flex-1"
                onClick={() => onRestore(item.id)}
              >
                <RotateCcw className="size-3.5" />
                Restore
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Delete permanently"
                onClick={() => setDeleting(item)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete permanently?"
        description={`“${deleting?.title ?? ''}” will be permanently deleted, along with its history on this board. Restore it instead if you might work it again.`}
        pending={deletePending ?? false}
        onConfirm={() => {
          if (!deleting) return
          onDelete(deleting.id)
          setDeleting(null)
        }}
      />
    </div>
  )
}
