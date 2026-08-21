import { useEffect, useState } from 'react'
import { Pause, Play, ShieldBan } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { TextingNav } from '@/components/texting-nav'
import {
  useSuppressionSummary,
  useTextingSettings,
  useUpdateTextingSettings,
} from '@/hooks/use-texting'
import { cn } from '@/lib/utils'

/** federal_dnc -> "Federal DNC", wrong_person -> "Wrong person" */
function reasonLabel(reason: string): string {
  const pretty = reason.replace(/_/g, ' ')
  return (pretty.charAt(0).toUpperCase() + pretty.slice(1)).replace(/\bdnc\b/i, 'DNC')
}

/** Postgres time "08:00:00" -> input[type=time] value "08:00". */
const toTimeInput = (t: string) => t.slice(0, 5)

/**
 * The texting_settings singleton — Alex-only. Pause is the one control that must never be
 * hunted for, so it applies immediately; the rest save as a batch.
 */
export function TextingSettingsPage() {
  const { data: settings, isLoading } = useTextingSettings()
  const { data: suppressions } = useSuppressionSummary()
  const update = useUpdateTextingSettings()

  const [quietStart, setQuietStart] = useState('')
  const [quietCutoff, setQuietCutoff] = useState('')
  const [dailyCap, setDailyCap] = useState('')
  const [rampStartedOn, setRampStartedOn] = useState('')

  useEffect(() => {
    if (!settings) return
    setQuietStart(toTimeInput(settings.quiet_start))
    setQuietCutoff(toTimeInput(settings.quiet_cutoff))
    setDailyCap(String(settings.per_line_daily_cap))
    setRampStartedOn(settings.ramp_started_on ?? '')
  }, [settings])

  const togglePaused = async () => {
    if (!settings) return
    try {
      await update.mutateAsync({ paused: !settings.paused })
      toast.success(settings.paused ? 'Sending resumed.' : 'Sending paused.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The update failed.')
    }
  }

  const saveRest = async () => {
    try {
      await update.mutateAsync({
        quiet_start: quietStart || '08:00',
        quiet_cutoff: quietCutoff || '19:30',
        per_line_daily_cap: Math.max(1, Number(dailyCap) || 100),
        ramp_started_on: rampStartedOn || null,
      })
      toast.success('Settings saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The save failed.')
    }
  }

  if (isLoading || !settings) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Texting settings</h1>
          <TextingNav />
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Texting settings</h1>
        <TextingNav />
      </div>

      {/* Pause — the master switch, loud when it's off. */}
      <Card className={cn(settings.paused && 'border-red-200 bg-red-50')}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className={cn('font-medium', settings.paused && 'text-red-700')}>
              {settings.paused ? 'Sending is paused' : 'Sending is live'}
            </p>
            <p className={cn('text-sm', settings.paused ? 'text-red-600/80' : 'text-muted-foreground')}>
              {settings.paused
                ? 'No text goes out — approved rows wait until sending resumes.'
                : 'Approved rows go out inside quiet hours and caps.'}
            </p>
          </div>
          <Button
            variant={settings.paused ? 'default' : 'destructive'}
            onClick={togglePaused}
            disabled={update.isPending}
          >
            {settings.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            {settings.paused ? 'Resume sending' : 'Pause sending'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Guardrails</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-1">
              <Label htmlFor="quiet-start">Quiet hours start</Label>
              <Input
                id="quiet-start"
                type="time"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                className="w-32"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="quiet-cutoff">Quiet hours cutoff</Label>
              <Input
                id="quiet-cutoff"
                type="time"
                value={quietCutoff}
                onChange={(e) => setQuietCutoff(e.target.value)}
                className="w-32"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="daily-cap">Per-line daily cap</Label>
              <Input
                id="daily-cap"
                type="number"
                min={1}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
                className="w-28"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ramp-start">Ramp started on</Label>
            <Input
              id="ramp-start"
              type="date"
              value={rampStartedOn}
              onChange={(e) => setRampStartedOn(e.target.value)}
              className="w-44"
            />
            <p className="text-xs text-muted-foreground">
              Effective daily cap = min(cap, 20 + 10 × days since ramp start). Blank means
              sending has never been enabled.
            </p>
          </div>
          <Button onClick={saveRest} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldBan className="size-4" /> Suppressed numbers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {suppressions?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {suppressions.map((s) => (
                <Badge key={s.reason} variant="outline" className="tabular-nums">
                  {reasonLabel(s.reason)} · {s.count}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No suppressed numbers.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Read-only — suppressions come from scrubs, opt-outs and VA verdicts, never from
            this page.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default TextingSettingsPage
