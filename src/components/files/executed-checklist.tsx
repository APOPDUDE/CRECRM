import { CheckCircle2, Circle } from 'lucide-react'
import { useFiles, fileCategoryLabels } from '@/hooks/use-files'
import type { Enums } from '@/lib/database.types'
import { cn } from '@/lib/utils'

type FileCategory = Enums<'file_category'>

interface ExecutedChecklistProps {
  matchId: string
  dealType: Enums<'deal_type'> | null
}

/** Auto-checks each required executed document from the categories already uploaded on the match. */
export function ExecutedChecklist({ matchId, dealType }: ExecutedChecklistProps) {
  const { data: files = [] } = useFiles('match', matchId)
  const present = new Set(files.map((f) => f.category))

  const items: { label: string; category: FileCategory }[] = [
    dealType === 'sale'
      ? { label: 'Executed PSA', category: 'psa' }
      : { label: 'Executed lease', category: 'lease' },
    { label: fileCategoryLabels.coi_insurance, category: 'coi_insurance' },
    { label: fileCategoryLabels.guarantee, category: 'guarantee' },
  ]

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground">Executed documents</p>
      <ul className="space-y-1.5">
        {items.map((item) => {
          const done = present.has(item.category)
          return (
            <li
              key={item.category}
              className={cn(
                'flex items-center gap-2 text-sm',
                done ? 'text-foreground' : 'text-amber-600',
              )}
            >
              {done ? (
                <CheckCircle2 className="size-4 text-green-600" />
              ) : (
                <Circle className="size-4" />
              )}
              {item.label}
              {!done && <span className="text-xs">— missing</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
