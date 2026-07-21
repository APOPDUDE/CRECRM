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

/** Executed-deal terms, keyed to the execute_pursuit RPC params (written to a comp). */
export interface ExecutedResult {
  executedDate: string | null
  actualFee: number | null
  closeClient: boolean
  closeListing: boolean
  economics: Record<string, unknown>
}

interface ExecutedMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dealType?: Enums<'deal_type'>
  /** Inputs the dialog can't see, used to estimate the commission. */
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
  dealType = 'lease',
  commissionCalcContext,
  pending,
  onConfirm,
}: ExecutedMatchDialogProps) {
  const isSale = dealType === 'sale'
  const [fee, setFee] = useState('')
  const [feeTouched, setFeeTouched] = useState(false)
  const [executionDate, setExecutionDate] = useState('')
  const [closeClient, setCloseClient] = useState(true)
  const [closeListing, setCloseListing] = useState(false)
  // economics
  const [rate, setRate] = useState('')
  const [price, setPrice] = useState('')
  const [capRate, setCapRate] = useState('')
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
      setCloseClient(true)
      setCloseListing(false)
      setRate('')
      setPrice('')
      setCapRate('')
      setStructure('')
      setEscalations('')
      setTiPsf('')
      setTerm('')
      setFreeRent('')
    }
  }, [open])

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

  useEffect(() => {
    if (!feeTouched && calc?.netFee != null) setFee(String(Math.round(calc.netFee)))
  }, [calc?.netFee, feeTouched])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const economics: Record<string, unknown> = {}
    if (isSale) {
      if (numOrNull(price) != null) economics.sale_price = numOrNull(price)
      if (numOrNull(capRate) != null) economics.cap_rate_pct = numOrNull(capRate)
    } else {
      if (numOrNull(rate) != null) economics.executed_rate_psf = numOrNull(rate)
      if (structure) economics.lease_structure = structure
      if (numOrNull(term) != null) economics.term_months = numOrNull(term)
      if (numOrNull(freeRent) != null) economics.free_rent_months = numOrNull(freeRent)
      if (numOrNull(tiPsf) != null) economics.ti_psf = numOrNull(tiPsf)
      if (escalations.trim()) economics.escalations = escalations.trim()
    }
    onConfirm({
      executedDate: executionDate || null,
      actualFee: fee ? Number(fee) : null,
      closeClient,
      closeListing,
      economics,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark executed</DialogTitle>
          <DialogDescription>Record the deal terms — they become a comp.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="executed-date">Execution date</Label>
            <Input
              id="executed-date"
              type="date"
              value={executionDate}
              onChange={(e) => setExecutionDate(e.target.value)}
            />
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground">
              {isSale ? 'Sale terms' : 'Executed lease terms'}
            </p>
            {isSale ? (
              <div className="grid grid-cols-2 gap-3">
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
                <div className="space-y-2">
                  <Label htmlFor="executed-caprate">Cap rate %</Label>
                  <Input
                    id="executed-caprate"
                    type="number"
                    inputMode="decimal"
                    value={capRate}
                    onChange={(e) => setCapRate(e.target.value)}
                    placeholder="%"
                  />
                </div>
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
                        <SelectItem value="FS">FS</SelectItem>
                        <SelectItem value="IG">IG</SelectItem>
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
            {calc?.netFee != null && !feeTouched && (
              <p className="text-xs text-muted-foreground">
                Prefilled from the estimate — edit if the actual fee differs.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={closeClient} onCheckedChange={(v) => setCloseClient(v === true)} />
              Mark this client closed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={closeListing} onCheckedChange={(v) => setCloseListing(v === true)} />
              Also close the listing on this property
            </label>
          </div>

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
