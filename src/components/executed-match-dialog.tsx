import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

export interface ExecutedResult {
  actualFee: number | null
  executionDate: string | null
  markListingClosed: boolean
  moveTenantExecuted: boolean
}

interface ExecutedMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hasListing: boolean
  hasTenantRep: boolean
  pending?: boolean
  onConfirm: (result: ExecutedResult) => void
}

export function ExecutedMatchDialog({
  open,
  onOpenChange,
  hasListing,
  hasTenantRep,
  pending,
  onConfirm,
}: ExecutedMatchDialogProps) {
  const [fee, setFee] = useState('')
  const [executionDate, setExecutionDate] = useState('')
  const [closeListing, setCloseListing] = useState(true)
  const [bumpTenant, setBumpTenant] = useState(true)

  useEffect(() => {
    if (open) {
      setFee('')
      setExecutionDate(format(new Date(), 'yyyy-MM-dd'))
      setCloseListing(true)
      setBumpTenant(true)
    }
  }, [open])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onConfirm({
      actualFee: fee ? Number(fee) : null,
      executionDate: executionDate || null,
      markListingClosed: hasListing && closeListing,
      moveTenantExecuted: hasTenantRep && bumpTenant,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark executed</DialogTitle>
          <DialogDescription>Record the deal and sync the linked records.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="executed-fee">Actual fee</Label>
              <Input
                id="executed-fee"
                type="number"
                inputMode="numeric"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="$"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="executed-date">Execution date</Label>
              <Input
                id="executed-date"
                type="date"
                value={executionDate}
                onChange={(e) => setExecutionDate(e.target.value)}
              />
            </div>
          </div>
          {(hasListing || hasTenantRep) && (
            <div className="space-y-2">
              {hasListing && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={closeListing}
                    onCheckedChange={(v) => setCloseListing(v === true)}
                  />
                  Mark the listing Closed
                </label>
              )}
              {hasTenantRep && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={bumpTenant}
                    onCheckedChange={(v) => setBumpTenant(v === true)}
                  />
                  Move the tenant rep to Executed
                </label>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Mark executed'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
