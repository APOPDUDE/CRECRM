import { useState } from 'react'

/**
 * Run `reset` during render whenever `deps` change (compared like an effect's dependency
 * list), and once on the first render. It exists for the "reset the form when the dialog
 * opens / the record changes" case that used to be `useEffect(() => setX(...), [deps])`.
 *
 * Why not an effect: setting state in an effect commits and paints the stale values first,
 * then re-renders — and react-hooks/set-state-in-effect rejects it. This is the React docs'
 * "adjusting state when a prop changes" pattern: state set during render is applied before
 * anything is painted, so the new values land in the same frame.
 *
 * `reset` may only set state that belongs to the calling component, and every dep must keep
 * its identity across renders of that component (props, state, memoized values). A value
 * rebuilt on each render — a `data = []` destructuring default, an inline object — would
 * re-trigger the reset on every pass, and React stops that with "Too many re-renders".
 */
export function useResetOn(deps: readonly unknown[], reset: () => void) {
  const [prev, setPrev] = useState<readonly unknown[] | null>(null)
  if (prev === null || prev.length !== deps.length || deps.some((d, i) => !Object.is(d, prev[i]))) {
    setPrev(deps)
    reset()
  }
}
