import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
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
import { useUpsertComp, type PropertyComp } from '@/hooks/use-comps'
import { useAuth } from '@/hooks/use-auth'
import type { TablesUpdate } from '@/lib/database.types'

const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v))
const NO_STRUCT = '__none'

interface CompEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  propertyId: string
  /** Which kind a NEW comp is; ignored when editing (comp.kind wins). */
  kind: 'asking' | 'executed'
  comp?: PropertyComp | null
}

/** Add or edit a single asking/executed comp on a property (all lease/sale terms + commission). */
export function CompEditDialog({ open, onOpenChange, propertyId, kind, comp }: CompEditDialogProps) {
  const upsert = useUpsertComp()
  const { session } = useAuth()
  const editing = !!comp
  const k = (comp?.kind as 'asking' | 'executed') ?? kind
  const isExecuted = k === 'executed'

  const [dealType, setDealType] = useState<'lease' | 'sale'>('lease')
  const [asOf, setAsOf] = useState('')
  const [sf, setSf] = useState('')
  const [cap, setCap] = useState('')
  const [rate, setRate] = useState('')
  const [price, setPrice] = useState('')
  const [structure, setStructure] = useState(NO_STRUCT)
  const [term, setTerm] = useState('')
  const [freeRent, setFreeRent] = useState('')
  const [ti, setTi] = useState('')
  const [escal, setEscal] = useState('')
  const [commence, setCommence] = useState('')
  const [expire, setExpire] = useState('')
  const [fee, setFee] = useState('')

  useEffect(() => {
    if (!open) return
    setDealType((comp?.deal_type as 'lease' | 'sale') ?? 'lease')
    setAsOf(comp?.as_of_date ?? comp?.executed_at ?? format(new Date(), 'yyyy-MM-dd'))
    setSf(comp?.sf?.toString() ?? '')
    setCap(comp?.cap_rate_pct?.toString() ?? '')
    setRate(((k === 'asking' ? comp?.asking_lease_rate_psf : comp?.executed_lease_rate_psf) ?? '').toString())
    setPrice(comp?.sale_price?.toString() ?? '')
    setStructure(comp?.lease_structure ?? NO_STRUCT)
    setTerm(comp?.term_months?.toString() ?? '')
    setFreeRent(comp?.free_rent_months?.toString() ?? '')
    setTi(comp?.ti_psf?.toString() ?? '')
    setEscal(comp?.escalations ?? '')
    setCommence(comp?.commencement_date ?? '')
    setExpire(comp?.expiration_date ?? '')
    setFee(comp?.commission_fee?.toString() ?? '')
  }, [open, comp, k])

  const isSale = dealType === 'sale'

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const payload: TablesUpdate<'comps'> & { property_id: string } = {
      property_id: propertyId,
      kind: k,
      deal_type: dealType,
      as_of_date: asOf || null,
      sf: numOrNull(sf),
      cap_rate_pct: numOrNull(cap),
      sale_price: isSale ? numOrNull(price) : null,
      asking_lease_rate_psf: !isSale && k === 'asking' ? numOrNull(rate) : null,
      executed_lease_rate_psf: !isSale && isExecuted ? numOrNull(rate) : null,
    }
    if (isExecuted) {
      payload.owner_id = session?.user.id ?? null // executed comps require an owner (CHECK constraint)
      payload.commission_fee = numOrNull(fee)
      payload.executed_at = asOf || null
      payload.lease_structure = !isSale && structure !== NO_STRUCT ? (structure as TablesUpdate<'comps'>['lease_structure']) : null
      payload.term_months = !isSale ? numOrNull(term) : null
      payload.free_rent_months = !isSale ? numOrNull(freeRent) : null
      payload.ti_psf = !isSale ? numOrNull(ti) : null
      payload.escalations = !isSale ? escal || null : null
      payload.commencement_date = !isSale ? commence || null : null
      payload.expiration_date = !isSale ? expire || null : null
    }
    if (editing) payload.id = comp!.id

    upsert.mutate(payload, {
      onSuccess: () => {
        toast.success(editing ? 'Comp updated' : 'Comp added')
        onOpenChange(false)
      },
      onError: () => toast.error('Could not save comp'),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Edit' : 'Add'} {k} comp
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Deal type</Label>
              <Select value={dealType} onValueChange={(v) => setDealType(v as 'lease' | 'sale')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lease">Lease</SelectItem>
                  <SelectItem value="sale">Sale</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{isExecuted ? 'Executed date' : 'As-of date'}</Label>
              <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </div>
            {isSale ? (
              <div className="space-y-2">
                <Label>Sale price</Label>
                <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>{isExecuted ? 'Executed' : 'Asking'} rate $/SF/yr</Label>
                <Input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label>Building SF</Label>
              <Input type="number" value={sf} onChange={(e) => setSf(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Cap rate %</Label>
              <Input type="number" step="0.01" value={cap} onChange={(e) => setCap(e.target.value)} />
            </div>
            {isExecuted && (
              <div className="space-y-2">
                <Label>Commission booked</Label>
                <Input type="number" value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
            )}
          </div>

          {isExecuted && !isSale && (
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div className="space-y-2">
                <Label>Lease structure</Label>
                <Select value={structure} onValueChange={setStructure}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_STRUCT}>—</SelectItem>
                    <SelectItem value="NNN">NNN</SelectItem>
                    <SelectItem value="NN">NN</SelectItem>
                    <SelectItem value="MG">MG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Term (months)</Label>
                <Input type="number" value={term} onChange={(e) => setTerm(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Free rent (months)</Label>
                <Input type="number" value={freeRent} onChange={(e) => setFreeRent(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>TI $/SF</Label>
                <Input type="number" value={ti} onChange={(e) => setTi(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Commencement</Label>
                <Input type="date" value={commence} onChange={(e) => setCommence(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Expiration</Label>
                <Input type="date" value={expire} onChange={(e) => setExpire(e.target.value)} />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Escalations</Label>
                <Input value={escal} onChange={(e) => setEscal(e.target.value)} placeholder="e.g. 3%/yr" />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={upsert.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : editing ? 'Save' : 'Add comp'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
