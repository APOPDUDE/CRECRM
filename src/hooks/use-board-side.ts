import { usePersistentState } from '@/hooks/use-persistent-state'
import type { DealSide } from '@/lib/stages'

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
