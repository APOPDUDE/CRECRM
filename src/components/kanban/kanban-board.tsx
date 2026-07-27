import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { StageDef } from '@/lib/stages'
import { cn } from '@/lib/utils'

interface KanbanBoardProps<TItem, TStage extends string> {
  columns: StageDef<TStage>[]
  items: TItem[]
  getId: (item: TItem) => string
  getStage: (item: TItem) => TStage
  onMove: (item: TItem, toStage: TStage) => void
  /**
   * Dropped within its own column — `before` is the card it was dropped above, or null
   * when it landed at the bottom. Omit to leave columns in their stored order.
   */
  onReorder?: (item: TItem, before: TItem | null) => void
  renderCard: (item: TItem) => ReactNode
}

function SortableCard({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // No touch-action:none here — a quick swipe should scroll the board on a phone.
      // The TouchSensor uses a press-delay so a long-press (not a swipe) starts a drag.
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('outline-none', isDragging && 'opacity-40')}
    >
      {children}
    </div>
  )
}

/**
 * A blue that deepens as the stage advances (light → deep), so pipeline
 * progression reads left-to-right at a glance. Stays within the one-accent palette.
 */
function stageAccent(index: number, total: number): string {
  const t = total > 1 ? index / (total - 1) : 1
  const lightness = 0.8 - t * 0.34
  const chroma = 0.05 + t * 0.14
  return `oklch(${lightness.toFixed(3)} ${chroma.toFixed(3)} 262.5)`
}

function DroppableColumn<TStage extends string>({
  column,
  count,
  accent,
  children,
}: {
  column: StageDef<TStage>
  count: number
  accent: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.value })
  return (
    <div
      className={cn(
        'flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/40 transition-colors',
        isOver && 'border-primary/50 bg-primary/5',
      )}
    >
      {/* progression accent — deepens toward the final stage */}
      <div className="h-1" style={{ backgroundColor: accent }} />
      <div className="flex items-center justify-between gap-2 border-b bg-background/60 px-3 py-2">
        <span className="text-sm font-medium">{column.label}</span>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground tabular-nums shadow-sm">
          {count}
        </span>
      </div>
      <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 p-2">
        {children}
      </div>
    </div>
  )
}

export function KanbanBoard<TItem, TStage extends string>({
  columns,
  items,
  getId,
  getStage,
  onMove,
  onReorder,
  renderCard,
}: KanbanBoardProps<TItem, TStage>) {
  const [activeId, setActiveId] = useState<string | null>(null)
  // Mouse: a 6px threshold means a plain click still opens the card, but a drag moves it.
  // Touch: a 200ms press-delay (with an 8px tolerance) means a swipe scrolls the board and a
  // long-press starts a drag — otherwise every card touch would hijack vertical scrolling.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const activeItem = activeId ? items.find((i) => getId(i) === activeId) ?? null : null

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id))

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const item = items.find((i) => getId(i) === String(active.id))
    if (!item) return

    const overId = String(over.id)
    // `over` is either a column (dropped on empty space) or another card.
    const overItem = items.find((i) => getId(i) === overId) ?? null
    const toStage = (overItem ? getStage(overItem) : overId) as TStage

    if (getStage(item) !== toStage) {
      onMove(item, toStage)
      return
    }
    if (!onReorder || !overItem || getId(overItem) === getId(item)) return

    // Within one column: work out which card it now sits above. Dragging downwards puts
    // it *after* the card it was dropped on, so the anchor is that card's successor.
    const columnItems = items.filter((i) => getStage(i) === toStage)
    const from = columnItems.findIndex((i) => getId(i) === getId(item))
    const to = columnItems.findIndex((i) => getId(i) === overId)
    if (from === -1 || to === -1 || from === to) return
    const before = from < to ? (columnItems[to + 1] ?? null) : overItem
    onReorder(item, before)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((column, index) => {
          const columnItems = items.filter((i) => getStage(i) === column.value)
          return (
            <DroppableColumn
              key={column.value}
              column={column}
              count={columnItems.length}
              accent={stageAccent(index, columns.length)}
            >
              <SortableContext
                items={columnItems.map(getId)}
                strategy={verticalListSortingStrategy}
              >
                {columnItems.map((item) => (
                  <SortableCard key={getId(item)} id={getId(item)}>
                    {renderCard(item)}
                  </SortableCard>
                ))}
              </SortableContext>
            </DroppableColumn>
          )
        })}
      </div>
      <DragOverlay>{activeItem ? renderCard(activeItem) : null}</DragOverlay>
    </DndContext>
  )
}
