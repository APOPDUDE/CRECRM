import { useEffect, useState } from 'react'

/**
 * `useState` backed by localStorage so a value survives navigation and reloads.
 * Used for sticky property filters + the configurable column set, so clicking into
 * a property and coming back keeps the list exactly as it was. JSON-serialized;
 * falls back to `initial` on any parse/quota error.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw != null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ignore serialization / quota errors — sticky state is best-effort
    }
  }, [key, value])

  return [value, setValue] as const
}
