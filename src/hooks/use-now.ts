import { useState } from 'react'

/**
 * The wall clock, frozen at mount. For "is this recent / how many days old" math done in
 * render: a live Date.now() makes one render disagree with the next as the clock ticks
 * (and react-hooks/purity rejects it). Anything that must be current at the moment of an
 * action reads Date.now() in the event handler instead.
 */
export function useNow(): number {
  const [now] = useState(() => Date.now())
  return now
}
