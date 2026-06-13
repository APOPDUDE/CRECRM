import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { StageDef } from '@/lib/stages'
import { cn } from '@/lib/utils'

interface KanbanBoardProps<TItem, TStage extends string> {
  columns: StageDef<TStage>[]
  items: TItem[]
  getId: (item: TItem) => string
  getStage: (item: TItem) => TStage
  onMove: (item: TItem, toStage: TStage) => void
  renderCard: (item: TItem) => ReactNode
}

function DraggableCard({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // touch-none lets pointer drag work on touch screens without the page scrolling
      className={cn('touch-none outline-none', isDragging && 'opacity-40')}
    >
      {children}
    </div>
  )
}

function DroppableColumn<TStage extends string>({
  column,
  count,
  children,
}: {
  column: StageDef<TStage>
  count: number
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.value })
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-sm font-medium">{column.label}</span>
        <span className="rounded-full bg-muted px-2 text-xs text-muted-foreground">{count}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 rounded-lg border border-transparent p-1 transition-colors',
          isOver && 'border-primary/40 bg-primary/5',
        )}
      >
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
  renderCard,
}: KanbanBoardProps<TItem, TStage>) {
  const [activeId, setActiveId] = useState<string | null>(null)
  // a small distance threshold means a plain click still opens the card, but a drag moves it
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const activeItem = activeId ? items.find((i) => getId(i) === activeId) ?? null : null

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id))

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const item = items.find((i) => getId(i) === String(active.id))
    if (!item) return
    const toStage = String(over.id) as TStage
    if (getStage(item) !== toStage) onMove(item, toStage)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((column) => {
          const columnItems = items.filter((i) => getStage(i) === column.value)
          return (
            <DroppableColumn key={column.value} column={column} count={columnItems.length}>
              {columnItems.map((item) => (
                <DraggableCard key={getId(item)} id={getId(item)}>
                  {renderCard(item)}
                </DraggableCard>
              ))}
            </DroppableColumn>
          )
        })}
      </div>
      <DragOverlay>{activeItem ? renderCard(activeItem) : null}</DragOverlay>
    </DndContext>
  )
}
