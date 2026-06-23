import { useEffect, useState } from 'react'
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
import { useCreateUnit } from '@/hooks/use-units'
import { friendlyDbError } from '@/lib/db-errors'

export type ParcelOption = { id: string; address: string }

interface AddUnitDialogProps {
  /** Parcels the unit can belong to (the listing's assemblage). */
  parcels: ParcelOption[]
  defaultPropertyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const intOrNull = (v: string) => (v.trim() ? Math.round(Number(v)) : null)
const numOrNull = (v: string) => (v.trim() ? Number(v) : null)

/** Add one available unit (suite / pad / acreage) to a property in the assemblage. */
export function AddUnitDialog({ parcels, defaultPropertyId, open, onOpenChange }: AddUnitDialogProps) {
  const createUnit = useCreateUnit()
  const [propertyId, setPropertyId] = useState(defaultPropertyId)
  const [label, setLabel] = useState('')
  const [sf, setSf] = useState('')
  const [acres, setAcres] = useState('')
  const [rate, setRate] = useState('')

  useEffect(() => {
    if (open) {
      setPropertyId(defaultPropertyId)
      setLabel('')
      setSf('')
      setAcres('')
      setRate('')
    }
  }, [open, defaultPropertyId])

  const canSave = !!propertyId && (sf.trim() !== '' || acres.trim() !== '')

  const handleSave = () => {
    if (!canSave) return
    createUnit.mutate(
      {
        property_id: propertyId,
        label: label.trim() || null,
        size_sf: intOrNull(sf),
        size_acres: numOrNull(acres),
        asking_rate_psf: numOrNull(rate),
      },
      {
        onSuccess: () => {
          toast.success('Unit added')
          onOpenChange(false)
        },
        onError: (e) => toast.error(friendlyDbError(e, 'Could not add the unit')),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add available unit</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {parcels.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="unit-parcel">Parcel</Label>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger id="unit-parcel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {parcels.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.address}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="unit-label">Label (optional)</Label>
            <Input
              id="unit-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Suite 100, Bay 3, North pad"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="unit-sf">SF</Label>
              <Input id="unit-sf" type="number" inputMode="numeric" value={sf} onChange={(e) => setSf(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit-acres">Acres</Label>
              <Input id="unit-acres" type="number" inputMode="decimal" step="0.01" value={acres} onChange={(e) => setAcres(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit-rate">Rate $/SF</Label>
              <Input id="unit-rate" type="number" inputMode="decimal" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Enter a SF and/or acreage for the unit.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || createUnit.isPending}>
            {createUnit.isPending ? 'Adding…' : 'Add unit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
