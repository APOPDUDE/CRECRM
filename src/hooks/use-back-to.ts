import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Back that means "where I actually came from", not "the list this record belongs to".
 *
 * A buyer is reached from the Buyers page, a contact from that buyer's deal, another deal from
 * that contact. A hardcoded destination throws the trail away and drops you at a list you
 * weren't looking at — and it disagrees with the phone's own swipe-back gesture, which does
 * follow history. This follows history too.
 *
 * React Router stamps an index on each history entry; above 0 means there is a previous page
 * inside this session to return to. A cold deep link (opened from a text, a bookmark, a new
 * tab) has none — that is the only case where the destination is guessed, and `fallback` is
 * the guess.
 */
export function useBackTo(fallback: string) {
  const navigate = useNavigate()
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }, [navigate, fallback])
}
