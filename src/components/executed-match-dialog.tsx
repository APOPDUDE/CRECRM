import { useEffect, useMemo, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Enums } from '@/lib/database.types'
import { calculateCommission } from '@/lib/commission'
import { formatCurrency } from '@/lib/format'

/** Executed-deal economics captured on the match (asking-vs-executed comps live here). */
export interface ExecutedEconomics {
  executed_rate_psf: number | null
  executed_price: number | null
  lease_structure: Enums<'lease_structure'> | null
  escalations: string | null
  ti_psf: number | null
  term_months: number | null
  free_rent_months: number | null
}

export interface ExecutedResult {
  actualFee: number | null
  executionDate: string | null
  markListingClosed: boolean
  moveTenantExecuted: boolean
  economics: ExecutedEconomics
}

interface ExecutedMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hasListing: boolean
  hasTenantRep: boolean
  dealType?: Enums<'deal_type'>
  /** Listing-derived inputs the dialog can't see, used to estimate the commission. */
  commissionCalcContext?: {
    commissionPct: number | null
    coBrokeSplitPct: number | null
    buildingSf: number | null
  } | null
  pending?: boolean
  onConfirm: (result: ExecutedResult) => void
}

const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v))

export function ExecutedMatchDialog({
  open,
  onOpenChange,
  hasListing,
  hasTenantRep,
  dealType = 'lease',
  commissionCalcContext,
  pending,
  onConfirm,
}: ExecutedMatchDialogProps) {
  const isSale = dealType === 'sale'
  const [fee, setFee] = useState('')
  // once the user edits the fee, stop auto-filling it from the calculator
  const [feeTouched, setFeeTouched] = useState(false)
  const [executionDate, setExecutionDate] = useState('')
  const [closeListing, setCloseListing] = useState(true)
  const [bumpTenant, setBumpTenant] = useState(true)
  // economics
  const [rate, setRate] = useState('')
  const [price, setPrice] = useState('')
  const [structure, setStructure] = useState<Enums<'lease_structure'> | ''>('')
  const [escalations, setEscalations] = useState('')
  const [tiPsf, setTiPsf] = useState('')
  const [term, setTerm] = useState('')
  const [freeRent, setFreeRent] = useState('')

  useEffect(() => {
    if (open) {
      setFee('')
      setFeeTouched(false)
      setExecutionDate(format(new Date(), 'yyyy-MM-dd'))
      setCloseListing(true)
      setBumpTenant(true)
      setRate('')
      setPrice('')
      setStructure('')
      setEscalations('')
      setTiPsf('')
      setTerm('')
      setFreeRent('')
    }
  }, [open])

  // Estimate the brokerage fee from the listing terms + the economics being entered.
  const calc = useMemo(() => {
    if (!commissionCalcContext) return null
    return calculateCommission({
      dealType,
      commissionPct: commissionCalcContext.commissionPct,
      coBrokeSplitPct: commissionCalcContext.coBrokeSplitPct,
      buildingSf: commissionCalcContext.buildingSf,
      executedRatePsf: numOrNull(rate),
      executedPrice: numOrNull(price),
      termMonths: numOrNull(term),
    })
  }, [commissionCalcContext, dealType, rate, price, term])

  // Suggest the computed fee until the user types their own.
  useEffect(() => {
    if (!feeTouched && calc?.netFee != null) setFee(String(Math.round(calc.netFee)))
  }, [calc?.netFee, feeTouched])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onConfirm({
      actualFee: fee ? Number(fee) : null,
      executionDate: executionDate || null,
      markListingClosed: hasListing && closeListing,
      moveTenantExecuted: hasTenantRep && bumpTenant,
      economics: {
        executed_rate_psf: isSale ? null : numOrNull(rate),
        executed_price: isSale ? numOrNull(price) : null,
        lease_structure: isSale ? null : structure || null,
        escalations: isSale ? null : escalations.trim() || null,
        ti_psf: isSale ? null : numOrNull(tiPsf),
        term_months: isSale ? null : numOrNull(term),
        free_rent_months: isSale ? null : numOrNull(freeRent),
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark executed</DialogTitle>
          <DialogDescription>Record the deal economics and sync the linked records.</DialogDescription>
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
                onChange={(e) => {
                  setFee(e.target.value)
                  setFeeTouched(true)
                }}
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

          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground">
              {isSale ? 'Sale terms' : 'Executed lease terms'}
            </p>
            {isSale ? (
              <div className="space-y-2">
                <Label htmlFor="executed-price">Sale price</Label>
                <Input
                  id="executed-price"
                  type="number"
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="$"
                />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="executed-rate">Rate $/SF</Label>
                    <Input
                      id="executed-rate"
                      type="number"
                      inputMode="decimal"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      placeholder="$/SF"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="executed-structure">Structure</Label>
                    <Select
                      value={structure}
                      onValueChange={(v) => setStructure(v as Enums<'lease_structure'>)}
                    >
                      <SelectTrigger id="executed-structure">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NNN">NNN</SelectItem>
                        <SelectItem value="NN">NN</SelectItem>
                        <SelectItem value="MG">MG</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="executed-term">Term (mo)</Label>
                    <Input
                      id="executed-term"
                      type="number"
                      inputMode="numeric"
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="executed-ti">TI $/SF</Label>
                    <Input
                      id="executed-ti"
                      type="number"
                      inputMode="decimal"
                      value={tiPsf}
                      onChange={(e) => setTiPsf(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="executed-freerent">Free rent (mo)</Label>
                    <Input
                      id="executed-freerent"
                      type="number"
                      inputMode="numeric"
                      value={freeRent}
                      onChange={(e) => setFreeRent(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="executed-escalations">Escalations</Label>
                  <Input
                    id="executed-escalations"
                    value={escalations}
                    onChange={(e) => setEscalations(e.target.value)}
                    placeholder="e.g. 3% annual"
                  />
                </div>
              </>
            )}
          </div>

          {calc?.netFee != null && (
            <div className="space-y-1 rounded-md bg-muted/50 p-2 text-xs">
              <p className="font-medium text-muted-foreground">Commission</p>
              {calc.dealValue != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {isSale ? 'Sale price' : 'Lease value'}
                  </span>
                  <span className="tabular-nums">{formatCurrency(calc.dealValue)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Gross fee</span>
                <span className="tabular-nums">{formatCurrency(calc.grossFee)}</span>
              </div>
              {calc.coBrokeShare ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Co-broke split</span>
                  <span className="tabular-nums">−{formatCurrency(calc.coBrokeShare)}</span>
                </div>
              ) : null}
              <div className="flex justify-between font-medium">
                <span>Estimated fee</span>
                <span className="tabular-nums">{formatCurrency(calc.netFee)}</span>
              </div>
            </div>
          )}

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
