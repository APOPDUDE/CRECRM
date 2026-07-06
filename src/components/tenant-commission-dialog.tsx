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
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateTenantRep } from '@/hooks/use-tenant-reps'
import type { TenantRepDetail } from '@/hooks/use-tenant-reps'
import { supabase } from '@/lib/supabase'
import { numOrNull } from '@/lib/format'

interface TenantCommissionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantRep: TenantRepDetail
}

/** Edit the commission booked on an executed tenant-rep deal (shown on the About panel). */
export function TenantCommissionDialog({ open, onOpenChange, tenantRep }: TenantCommissionDialogProps) {
  const updateTenantRep = useUpdateTenantRep()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const [fee, setFee] = useState('')
  const [commission, setCommission] = useState('')

  useEffect(() => {
    if (!open) return
    setFee(tenantRep.actual_fee?.toString() ?? '')
    setCommission(tenantRep.commission_pct?.toString() ?? '')
  }, [open, tenantRep])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const feeVal = numOrNull(fee)
    setSaving(true)
    try {
      await updateTenantRep.mutateAsync({
        id: tenantRep.id,
        actual_fee: feeVal,
        commission_pct: numOrNull(commission),
      })
      // the booked fee lives on the executed pursuit (the dashboard's YTD source)
      await supabase
        .from('pursuits')
        .update({ actual_fee: feeVal })
        .eq('client_id', tenantRep.id)
        .eq('stage', 'executed')
      queryClient.invalidateQueries({ queryKey: ['dashboard-matches'] })
      queryClient.invalidateQueries({ queryKey: ['matches'] })
      toast.success('Commission saved')
      onOpenChange(false)
    } catch {
      toast.error('Could not save commission')
    } finally {
      setSaving(false)
    }
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
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
