import { useState } from 'react'
import { Megaphone, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { TextingNav } from '@/components/texting-nav'
import { useCreateTextCampaign, useTextCampaigns } from '@/hooks/use-texting'

const COUNT_ORDER = [
  'draft',
  'approved',
  'queued',
  'sending',
  'sent',
  'delivered',
  'failed',
  'blocked',
] as const

/**
 * Campaigns — Alex-only (direct table writes are fine here; the VA never sees this route).
 * A campaign is a template + a daily cap. Enqueueing an audience into drafts arrives with
 * the send pipeline; until then this page defines campaigns and watches their counts.
 */
export function TextingCampaignsPage() {
  const { data: campaigns, isLoading } = useTextCampaigns()
  const createCampaign = useCreateTextCampaign()

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('')
  const [dailyCap, setDailyCap] = useState('50')

  const handleCreate = async () => {
    if (!name.trim() || !template.trim()) {
      toast.error('Name and template are required.')
      return
    }
    try {
      await createCampaign.mutateAsync({
        name: name.trim(),
        template: template.trim(),
        daily_cap: Math.max(1, Number(dailyCap) || 50),
      })
      setCreateOpen(false)
      setName('')
      setTemplate('')
      setDailyCap('50')
      toast.success('Campaign created.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The campaign could not be created.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Campaigns</h1>
        <div className="flex items-center gap-2">
          <TextingNav />
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New campaign
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !campaigns?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Megaphone className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No campaigns yet — create one to define the template and daily cap.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {c.name}
                  <Badge variant={c.status === 'active' ? 'default' : 'outline'}>{c.status}</Badge>
                  <span className="ml-auto text-sm font-normal text-muted-foreground tabular-nums">
                    Cap {c.daily_cap}/day
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="line-clamp-2 text-sm text-muted-foreground">{c.template}</p>
                <div className="flex flex-wrap gap-1.5">
                  {c.totalSends ? (
                    COUNT_ORDER.filter((s) => c.sendCounts[s]).map((s) => (
                      <Badge key={s} variant="outline" className="tabular-nums">
                        {s} · {c.sendCounts[s]}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No sends yet.</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Enqueue arrives with the send pipeline — campaigns defined here fill with drafts once
        it lands.
      </p>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>
              A template plus a daily cap. Drafts still need a human tap before they send.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="campaign-name">Name</Label>
              <Input
                id="campaign-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Pinellas industrial owners"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="campaign-template">Template</Label>
              <Textarea
                id="campaign-template"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={4}
                placeholder={'Hi {{first_name}}, quick question about {{address}}…'}
              />
              <p className="text-xs text-muted-foreground">
                {'{{first_name}} and {{address}} resolve when the batch is enqueued.'}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="campaign-cap">Daily cap</Label>
              <Input
                id="campaign-cap"
                type="number"
                min={1}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
                className="w-28"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createCampaign.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createCampaign.isPending}>
              {createCampaign.isPending ? 'Creating…' : 'Create campaign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default TextingCampaignsPage
