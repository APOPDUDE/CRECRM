import { useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useUpdatePropertyTags } from '@/hooks/use-properties'
import { cn } from '@/lib/utils'

/**
 * The tags we offer as one tap. Free text still works — this is a shortcut, not a
 * closed vocabulary, so a tag invented in GHL can still land here.
 */
const SUGGESTED = ['owner occupier', 'interested', 'not interested'] as const

const TAG_TONE: Record<string, string> = {
  'owner occupier': 'border-blue-200 bg-blue-50 text-blue-700',
  interested: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'not interested': 'border-amber-200 bg-amber-50 text-amber-700',
}

/**
 * Tags on the BUILDING, not the owner.
 *
 * "Owner occupier" is a fact about a site — an owner with five properties may occupy
 * one and lease the rest — so it cannot live on `owners.tags` next to the person-level
 * outcome tags without being wrong four times out of five.
 */
export function PropertyTags({ propertyId, tags }: { propertyId: string; tags: string[] | null }) {
  const update = useUpdatePropertyTags()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const current = tags ?? []
  const save = (next: string[]) =>
    update.mutate(
      { propertyId, tags: next },
      { onError: (e) => toast.error(`Could not update tags: ${e.message}`) },
    )

  const add = (tag: string) => {
    const t = tag.trim().toLowerCase()
    if (!t || current.includes(t)) return
    save([...current, t])
  }

  const unused = SUGGESTED.filter((t) => !current.includes(t))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {current.map((t) => (
        <Badge key={t} variant="outline" className={cn('gap-1', TAG_TONE[t] ?? 'text-muted-foreground')}>
          {t}
          <button
            type="button"
            title="Remove tag"
            onClick={() => save(current.filter((x) => x !== t))}
            className="opacity-50 hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      {unused.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => add(t)}
          className="rounded border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          + {t}
        </button>
      ))}

      {adding ? (
        <form
          className="inline-flex"
          onSubmit={(e) => {
            e.preventDefault()
            add(draft)
            setDraft('')
            setAdding(false)
          }}
        >
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setAdding(false)}
            placeholder="tag…"
            className="h-6 w-28 px-1.5 py-0 text-xs"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        >
          + tag
        </button>
      )}
    </div>
  )
}
