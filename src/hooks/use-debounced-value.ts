import { useEffect, useState } from 'react'

/**
 * Trails a fast-changing value (a search box) so queries fire on pauses rather than
 * keystrokes. Returns the latest value immediately when it settles to empty, so
 * clearing a search feels instant.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])

  return settled
}
