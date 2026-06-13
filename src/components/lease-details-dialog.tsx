import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { format, max, parseISO, subDays } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { contactNameOf } from '@/hooks/use-contacts'
import { useUpdateMatch } from '@/hooks/use-matches'
import type { MatchWithRelations } from '@/hooks/use-matches'
import { useUpsertRenewalTask } from '@/hooks/use-tasks'
import { useAuth } from '@/hooks/use-auth'

interface LeaseDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  match: MatchWithRelations
}

const RENEWAL_LEAD_DAYS = 90

export function LeaseDetailsDialog({ open, onOpenChange, match }: LeaseDetailsDialogProps) {
  const { session } = useAuth()
  const updateMatch = useUpdateMatch()
  const upsertRenewal = useUpsertRenewalTask()
  const pending = updateMatch.isPending || upsertRenewal.isPending

  const [execution, setExecution] = useState('')
  const [commencement, setCommencement] = useState('')
  const [expiration, setExpiration] = useState('')
  const [renewal, setRenewal] = useState('')

  useEffect(() => {
    if (open) {
      setExecution(match.execution_date ?? '')
      setCommencement(match.commencement_date ?? '')
      setExpiration(match.lease_expiration ?? '')
      setRenewal(match.lease_renewal_date ?? '')
    }
  }, [open, match])

  const tenantName =
    match.tenant_company?.name ??
    (match.tenant_contact ? contactNameOf(match.tenant_contact) : 'tenant')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await updateMatch.mutateAsync({
        id: match.id,
        execution_date: execution || null,
        commencement_date: commencement || null,
        lease_expiration: expiration || null,
        lease_renewal_date: renewal || null,
      })

      // auto-create a renewal reminder ~90 days before the notice deadline
      if (renewal && session?.user.id) {
        const target = match.tenant_rep_id
          ? { entityType: 'tenant_rep' as const, entityId: match.tenant_rep_id }
          : match.listing_id
            ? { entityType: 'listing' as const, entityId: match.listing_id }
            : null
        if (target) {
          const today = new Date()
          const due = max([subDays(parseISO(renewal), RENEWAL_LEAD_DAYS), today])
          await upsertRenewal.mutateAsync({
            owner: session.user.id,
            matchId: match.id,
            ...target,
            contactId: match.tenant_contact_id,
            title: `Reach out to ${tenantName} about renewal — ${match.property?.address ?? 'property'}`,
            dueDate: format(due, 'yyyy-MM-dd'),
          })
          toast.success('Lease saved · renewal reminder scheduled')
        } else {
          toast.success('Lease details saved')
        }
      } else {
        toast.success('Lease details saved')
      }
      onOpenChange(false)
    } catch {
      toast.error('Could not save lease details')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lease details</DialogTitle>
          <DialogDescription>
            A renewal reminder is created {RENEWAL_LEAD_DAYS} days before the renewal-notice date.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="lease-exec">Execution date</Label>
              <Input id="lease-exec" type="date" value={execution} onChange={(e) => setExecution(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lease-comm">Commencement</Label>
              <Input id="lease-comm" type="date" value={commencement} onChange={(e) => setCommencement(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lease-exp">Expiration</Label>
              <Input id="lease-exp" type="date" value={expiration} onChange={(e) => setExpiration(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lease-renewal">Renewal-notice date</Label>
              <Input id="lease-renewal" type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Skip
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save lease details'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
