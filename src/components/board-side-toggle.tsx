import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { dealSideLabels, type DealSide } from '@/lib/stages'

/**
 * Flips a board between its for-lease and its for-sale pursuits. Only rendered when a
 * client (or listing) actually works both sides — the two run different columns
 * (Negotiation/Executed vs PSA negotiation/Due diligence/Closed), so they can't share
 * one board. Each side keeps its own count so you can see what's waiting on the other.
 */
export function BoardSideToggle({
  sides,
  value,
  onChange,
  counts,
}: {
  sides: DealSide[]
  value: DealSide
  onChange: (side: DealSide) => void
  counts?: Record<DealSide, number>
}) {
  if (sides.length < 2) return null
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as DealSide)}>
      <TabsList>
        {sides.map((side) => (
          <TabsTrigger key={side} value={side}>
            {dealSideLabels[side]}
            {counts && (
              <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                {counts[side]}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

/**
 * The side a board is currently showing, remembered per entity so coming back to a
 * client lands where you left off. Falls back to the first available side whenever the
 * remembered one no longer applies (e.g. the client stopped working that side).
 */
export function useBoardSide(entityId: string | undefined, sides: DealSide[]) {
  const [stored, setStored] = usePersistentState<DealSide>(
    `board-side:${entityId ?? 'unknown'}`,
    'lease',
  )
  const side = sides.includes(stored) ? stored : (sides[0] ?? 'lease')
  return [side, setStored] as const
}
