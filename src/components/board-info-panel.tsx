import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen, StickyNote, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { FileSection } from '@/components/files/file-section'
import { NotesLog } from '@/components/notes-log'
import { cn } from '@/lib/utils'
import type { Enums } from '@/lib/database.types'

const COLLAPSE_KEY = 'board-info-collapsed'

/** Collapse state for the board info panel, persisted across boards in localStorage. */
export function useInfoPanelCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () =>
    setCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  return [collapsed, toggle] as const
}

/** Shared section wrapper used across both board info panels. */
export function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

interface BoardInfoPanelProps {
  entityType: Extract<Enums<'note_entity'>, 'listing' | 'tenant_rep'>
  entityId: string
  fileCategory: Enums<'file_category'>
  collapsed: boolean
  onToggle: () => void
  /** Board-specific info sections (contact, terms, requirements, map…). */
  children: ReactNode
}

/**
 * HubSpot-style "About this deal" panel: a visually distinct shaded rail with an
 * Upload file / Log note action row, the deal's info sections, and its files + notes.
 * Collapses (on lg+) to a thin strip so the board can take the full width.
 */
export function BoardInfoPanel({
  entityType,
  entityId,
  fileCategory,
  collapsed,
  onToggle,
  children,
}: BoardInfoPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  const triggerUpload = () =>
    panelRef.current?.querySelector<HTMLInputElement>('[data-file-input]')?.click()
  const focusNote = () => {
    const el = panelRef.current?.querySelector<HTMLTextAreaElement>('[data-note-input]')
    el?.focus()
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <>
      {/* Collapsed strip (lg only) — a thin shaded edge with an expand arrow next to the board. */}
      {collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Show deal details"
          title="Show deal details"
          className="hidden min-h-32 w-9 items-start justify-center rounded-lg border bg-muted/50 pt-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      )}

      {/* Full panel — always shown on mobile; on lg only when expanded. */}
      <div
        ref={panelRef}
        className={cn(
          'w-full space-y-4 rounded-lg border bg-muted/40 p-4 lg:w-80',
          collapsed && 'lg:hidden',
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">About this deal</h2>
          <button
            type="button"
            onClick={onToggle}
            aria-label="Hide deal details"
            title="Hide deal details"
            className="hidden size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>

        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" className="flex-1" onClick={triggerUpload}>
            <Upload className="size-4" />
            Upload file
          </Button>
          <Button type="button" size="sm" variant="outline" className="flex-1" onClick={focusNote}>
            <StickyNote className="size-4" />
            Log note
          </Button>
        </div>

        {children}

        <Separator />
        <SidebarSection title="Files">
          <FileSection entityType={entityType} entityId={entityId} defaultCategory={fileCategory} />
        </SidebarSection>

        <Separator />
        <SidebarSection title="Notes">
          <NotesLog entityType={entityType} entityId={entityId} />
        </SidebarSection>
      </div>
    </>
  )
}
