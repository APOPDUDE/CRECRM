import { useCallback, useEffect, useRef, useState } from 'react'
import type { OwnerRecipient } from '@/components/owner-outreach-dialog'

const DRAFT_URL = 'https://n8n.ayxco.com/webhook/owner-draft'

/** How far ahead of the person being reviewed to draft, so moving on never waits. */
const LOOKAHEAD = 2

export type OwnerDraft = {
  status: 'loading' | 'ready' | 'error'
  /** The text as it stands — the draft, or whatever Alex has edited it into. */
  text: string
  source: 'ai' | 'template' | null
  reason: string | null
  /** Goal the draft was written for, so a changed goal can supersede it. */
  goal: string
  /** True once edited by hand — a redraft or a goal change must not silently overwrite it. */
  touched: boolean
}

/**
 * Per-owner message drafts for the review pane.
 *
 * Drafting happens as Alex walks the list rather than in one batch up front: a 400-person
 * blast would spend credits on everyone including the people he never opens. To stop that
 * costing a wait on every step, the person in view plus the next two are drafted together,
 * so moving on lands on something already written.
 *
 * The tier decision (worth an AI call, or is the template already the honest answer) lives
 * in the workflow, not here — it is the same judgement whoever asks.
 */
export function useOwnerDrafts({
  enabled,
  goal,
  recipients,
  index,
  fallbackFor,
}: {
  enabled: boolean
  goal: string
  recipients: OwnerRecipient[]
  index: number
  fallbackFor: (r: OwnerRecipient) => string
}) {
  const [drafts, setDrafts] = useState<Map<string, OwnerDraft>>(new Map())
  const inFlight = useRef<Set<string>>(new Set())
  // Read inside the fetch without making it a dependency, which would re-fire on every keystroke.
  const goalRef = useRef(goal)
  goalRef.current = goal
  const fallbackRef = useRef(fallbackFor)
  fallbackRef.current = fallbackFor

  const fetchDraft = useCallback(async (r: OwnerRecipient, force = false) => {
    const id = r.recipientId
    if (inFlight.current.has(id)) return
    const currentGoal = goalRef.current.trim()
    inFlight.current.add(id)
    setDrafts((prev) => {
      const next = new Map(prev)
      const was = next.get(id)
      next.set(id, {
        status: 'loading',
        text: was?.text ?? '',
        source: was?.source ?? null,
        reason: null,
        goal: currentGoal,
        touched: force ? false : (was?.touched ?? false),
      })
      return next
    })
    try {
      const res = await fetch(DRAFT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: currentGoal,
          // What to fall back to. Rendering stays in the browser so the template a thin
          // contact gets is byte-identical to the one the preview showed.
          fallback: fallbackRef.current(r),
          propertyId: r.recipientId,
          ownerId: r.ownerId,
          recipient: {
            first: r.first,
            last: r.last,
            company: r.company,
            address: r.address,
            city: (r.ctx?.['property.city'] as string | undefined) ?? null,
          },
        }),
      })
      if (!res.ok) throw new Error(`draft failed (${res.status})`)
      const j = (await res.json()) as { text?: string; source?: string; reason?: string }
      setDrafts((prev) => {
        const next = new Map(prev)
        const was = next.get(id)
        // A hand edit outranks anything that arrives afterwards.
        if (was?.touched && !force) return prev
        next.set(id, {
          status: 'ready',
          text: j.text || fallbackRef.current(r),
          source: j.source === 'ai' ? 'ai' : 'template',
          reason: j.reason ?? null,
          goal: currentGoal,
          touched: false,
        })
        return next
      })
    } catch (e) {
      setDrafts((prev) => {
        const next = new Map(prev)
        const was = next.get(id)
        if (was?.touched) return prev
        // Never strand the reviewer: the template is always sendable.
        next.set(id, {
          status: 'error',
          text: fallbackRef.current(r),
          source: 'template',
          reason: e instanceof Error ? e.message : 'could not reach the drafter',
          goal: currentGoal,
          touched: false,
        })
        return next
      })
    } finally {
      inFlight.current.delete(id)
    }
  }, [])

  // Draft the person in view and the next two. A draft written before the goal was typed is
  // superseded once there is one, since it was only ever the template.
  useEffect(() => {
    if (!enabled || index < 0) return
    const g = goal.trim()
    for (let i = index; i < Math.min(index + 1 + LOOKAHEAD, recipients.length); i++) {
      const r = recipients[i]
      if (!r) continue
      const d = drafts.get(r.recipientId)
      const stale = d && !d.touched && d.status !== 'loading' && d.goal !== g
      if (!d || stale) void fetchDraft(r)
    }
  }, [enabled, index, goal, recipients, drafts, fetchDraft])

  const setText = useCallback((id: string, text: string) => {
    setDrafts((prev) => {
      const next = new Map(prev)
      const was = next.get(id)
      next.set(id, {
        status: 'ready',
        text,
        source: was?.source ?? 'template',
        reason: was?.reason ?? null,
        goal: was?.goal ?? '',
        touched: true,
      })
      return next
    })
  }, [])

  const redraft = useCallback((r: OwnerRecipient) => void fetchDraft(r, true), [fetchDraft])

  return { drafts, setText, redraft }
}
