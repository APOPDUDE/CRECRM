import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useFunnelDropoff } from '@/hooks/use-funnel-analytics'
import { cn } from '@/lib/utils'

/**
 * Where visitors quit the alexpoplawski.com funnels.
 *
 * Every screen view and every button press is recorded, whether or not the person ever
 * finishes — so this shows the steps that cost you people, which is the only thing that
 * tells you what to rewrite. Hidden until there is traffic to report.
 */

const TRACK_LABEL: Record<string, string> = {
  crm: 'Routed to the discovery call',
  advisory: 'Routed to the advisory hour',
  not_yet: 'Routed to not-yet',
  undecided: 'Left before finishing',
  advisory_old: 'Advisory call',
}

const FORM_LABEL: Record<string, string> = {
  consultation: 'Consultation',
  crm: 'Software',
  lead: 'Space',
}

/** Readable names for the step keys the site reports. */
const STEP_LABEL: Record<string, string> = {
  intent: 'What are you looking for',
  who: 'What do you do',
  broker_role: 'On a team or running one',
  who_other: 'So what do you do (other)',
  asset: 'What do you focus on',
  where: 'Where do you operate',
  country: 'Where in the world',
  tracking: 'How do you track data',
  tools: 'What do you pay for',
  team: 'Team size',
  volume: 'Volume last year',
  pain: 'What to fix',
  contact: 'Name, email, phone',
  book: 'Pick your time',
  notyet: 'Not the right fit yet',
  done: 'Booked',
  // retired screens, kept so older sessions still read properly
  qualify: 'Which one are you after (retired)',
  usstate: 'Which market (retired)',
  need: 'What do you want help with (retired)',
  details: 'Tell me about your business (retired)',
  revenue: 'Revenue (retired)',
  question: 'The one question (retired)',
  volume_investor: 'How much do you own (retired)',
  volume_broker: 'Deals last year (retired)',
  volume_brokerage: 'Agents on the team (retired)',
  volume_other: 'Revenue (retired)',
}

function stepName(step: string) {
  return STEP_LABEL[step] ?? step.replace(/_/g, ' ')
}

export function FunnelDropoffWidget() {
  const { data } = useFunnelDropoff(30)
  const [expanded, setExpanded] = useState(false)

  const groups = Object.entries(data ?? {}).filter(([, v]) => v.sessions > 0)
  if (groups.length === 0) return null

  const totalStarted = groups.reduce((n, [, v]) => n + v.sessions, 0)
  const totalFinished = groups.reduce((n, [, v]) => n + v.finished, 0)

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">Funnel drop-off</span>
        <span className="text-xs text-muted-foreground">
          {totalStarted} started · {totalFinished} finished · last 30 days
        </span>
      </button>

      {expanded && (
        <div className="space-y-4 border-t p-3">
          {groups.map(([key, group]) => {
            const [form, track] = key.split('|')
            const max = Math.max(...group.steps.map((s) => s.sessions ?? 0), 1)
            return (
              <div key={key}>
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-sm font-medium">
                    {TRACK_LABEL[track] ?? FORM_LABEL[form] ?? form}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {group.sessions} started, {group.finished} finished
                    {group.sessions > 0 &&
                      ` (${Math.round((group.finished / group.sessions) * 100)}%)`}
                  </span>
                </div>
                <div className="space-y-1">
                  {group.steps.map((s) => {
                    const reached = s.sessions ?? 0
                    const dropped = s.dropped_here ?? 0
                    const pct = Number(s.drop_pct ?? 0)
                    return (
                      <div key={s.step} className="flex items-center gap-2 text-xs">
                        <span className="w-44 shrink-0 truncate text-muted-foreground">
                          {stepName(s.step ?? '')}
                        </span>
                        <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                          <div
                            className="h-full bg-primary/70"
                            style={{ width: `${Math.round((reached / max) * 100)}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right tabular-nums">{reached}</span>
                        <span
                          className={cn(
                            'w-24 shrink-0 text-right tabular-nums',
                            pct >= 25
                              ? 'font-medium text-red-600'
                              : pct >= 10
                                ? 'text-amber-600'
                                : 'text-muted-foreground',
                          )}
                          title="Sessions whose last screen was this one"
                        >
                          {dropped > 0 ? `${dropped} left (${pct}%)` : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <p className="text-xs text-muted-foreground">
            &ldquo;Left&rdquo; counts sessions whose last screen was that one and who never
            submitted or booked. A step in red is costing you people.
          </p>
        </div>
      )}
    </div>
  )
}
