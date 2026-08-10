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
import { CurrencyInput } from '@/components/ui/currency-input'
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
import { numOrNull } from '@/lib/format'

export type ParcelOption = { id: string; address: string }

interface AddUnitDialogProps {
  /** Parcels the unit can belong to (the listing's assemblage). */
  parcels: ParcelOption[]
  defaultPropertyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const intOrNull = (v: string) => (v.trim() ? Math.round(Number(v)) : null)

/** Add one available unit (suite / pad / acreage) to a property in the assemblage. */
export function AddUnitDialog({ parcels, defaultPropertyId, open, onOpenChange }: AddUnitDialogProps) {
  const createUnit = useCreateUnit()
  const [propertyId, setPropertyId] = useState(defaultPropertyId)
  const [label, setLabel] = useState('')
  const [sf, setSf] = useState('')
  const [acres, setAcres] = useState('')
  const [rate, setRate] = useState('')
  // Suite-level specs. Left blank they stay null, which means "same as the building" —
  // only fill in what actually differs for this suite.
  const [officeSf, setOfficeSf] = useState('')
  const [dockHigh, setDockHigh] = useState('')
  const [gradeLevel, setGradeLevel] = useState('')
  const [levelers, setLevelers] = useState('')
  const [clearHeight, setClearHeight] = useState('')
  const [volts, setVolts] = useState('')
  const [amps, setAmps] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (open) {
      setPropertyId(defaultPropertyId)
      setLabel('')
      setSf('')
      setAcres('')
      setRate('')
      setOfficeSf('')
      setDockHigh('')
      setGradeLevel('')
      setLevelers('')
      setClearHeight('')
      setVolts('')
      setAmps('')
      setNotes('')
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
        office_sf: intOrNull(officeSf),
        dock_high_doors: intOrNull(dockHigh),
        grade_level_doors: intOrNull(gradeLevel),
        dock_levelers: intOrNull(levelers),
        clear_height_ft: numOrNull(clearHeight),
        volts: volts.trim() || null,
        amps: intOrNull(amps),
        notes: notes.trim() || null,
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
              <CurrencyInput id="unit-sf" value={sf} onValueChange={setSf} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit-acres">Acres</Label>
              <Input id="unit-acres" type="number" inputMode="decimal" step="0.01" value={acres} onChange={(e) => setAcres(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit-rate">Rate $/SF</Label>
              <CurrencyInput id="unit-rate" value={rate} onValueChange={setRate} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Enter a SF and/or acreage for the unit.</p>

          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Suite specs</p>
              <p className="text-xs text-muted-foreground">
                Only fill in what differs from the building — anything left blank inherits the
                building&apos;s value.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="unit-office">Office SF</Label>
                <CurrencyInput id="unit-office" value={officeSf} onValueChange={setOfficeSf} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit-dock">Dock high</Label>
                <Input id="unit-dock" type="number" inputMode="numeric" value={dockHigh} onChange={(e) => setDockHigh(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit-grade">Grade level</Label>
                <Input id="unit-grade" type="number" inputMode="numeric" value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit-levelers">Levelers</Label>
                <Input id="unit-levelers" type="number" inputMode="numeric" value={levelers} onChange={(e) => setLevelers(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit-clear">Clear ht (ft)</Label>
                <Input id="unit-clear" type="number" inputMode="decimal" step="0.5" value={clearHeight} onChange={(e) => setClearHeight(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit-amps">Amps</Label>
                <Input id="unit-amps" type="number" inputMode="numeric" value={amps} onChange={(e) => setAmps(e.target.value)} />
              </div>
              <div className="col-span-3 space-y-2">
                <Label htmlFor="unit-volts">Volts</Label>
                <Input id="unit-volts" value={volts} onChange={(e) => setVolts(e.target.value)} placeholder="e.g. 277-480" />
              </div>
              <div className="col-span-3 space-y-2">
                <Label htmlFor="unit-notes">Notes</Label>
                <Input id="unit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="anything specific to this suite" />
              </div>
            </div>
          </div>
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
