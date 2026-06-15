import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
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
import { useUpdateTenantRep } from '@/hooks/use-tenant-reps'
import type { TenantRepDetail } from '@/hooks/use-tenant-reps'

interface TenantCommissionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantRep: TenantRepDetail
}

const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v))

/** Edit the commission booked on an executed tenant-rep deal (shown on the About panel). */
export function TenantCommissionDialog({ open, onOpenChange, tenantRep }: TenantCommissionDialogProps) {
  const updateTenantRep = useUpdateTenantRep()

  const [fee, setFee] = useState('')
  const [commission, setCommission] = useState('')

  useEffect(() => {
    if (!open) return
    setFee(tenantRep.actual_fee?.toString() ?? '')
    setCommission(tenantRep.commission_pct?.toString() ?? '')
  }, [open, tenantRep])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    updateTenantRep.mutate(
      {
        id: tenantRep.id,
        actual_fee: numOrNull(fee),
        commission_pct: numOrNull(commission),
      },
      {
        onSuccess: () => {
          toast.success('Commission saved')
          onOpenChange(false)
        },
        onError: () => toast.error('Could not save commission'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Commission</DialogTitle>
          <DialogDescription>The fee booked on this executed deal.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tc-fee">Fee earned ($)</Label>
            <Input
              id="tc-fee"
              type="number"
              inputMode="numeric"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="$"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tc-commission">Commission %</Label>
            <Input
              id="tc-commission"
              type="number"
              inputMode="decimal"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateTenantRep.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateTenantRep.isPending}>
              {updateTenantRep.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
