import { useState } from 'react'

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
