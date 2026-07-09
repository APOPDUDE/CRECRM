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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useEnrichProperty, useUpdateProperty } from '@/hooks/use-properties'
import { formatParcelId, ENRICHABLE_COUNTIES } from '@/lib/parcel'

interface EnrichParcelDialogProps {
  property: { id: string; parcel_number: string | null; county: string | null }
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Enrich needs a parcel ID + a supported county. When either is missing, this dialog
 * collects them (auto-formatting the parcel to the county's dashed pattern), saves them
 * on the property, and runs the appraiser enrichment in one go. A parcel that the
 * appraiser can't find keeps the dialog open so a typo can be fixed on the spot.
 */
export function EnrichParcelDialog({ property, open, onOpenChange }: EnrichParcelDialogProps) {
  const updateProperty = useUpdateProperty()
  const enrich = useEnrichProperty()

  const [parcel, setParcel] = useState('')
  const [county, setCounty] = useState('')
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (open) {
      setParcel(property.parcel_number ?? '')
      setCounty(
        property.county && ENRICHABLE_COUNTIES.includes(property.county) ? property.county : '',
      )
      setNotFound(false)
    }
  }, [open, property])

  const pending = updateProperty.isPending || enrich.isPending
  const canSubmit = !!parcel.trim() && !!county && !pending

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setNotFound(false)
    const formatted = formatParcelId(parcel, county)
    try {
      await updateProperty.mutateAsync({ id: property.id, parcel_number: formatted, county })
    } catch {
      toast.error('Could not save the parcel details')
      return
    }
    enrich.mutate(property.id, {
      onSuccess: (d) => {
        const s = d?.results?.[0]?.status
        if (s === 'ok') {
          toast.success('Enriched from county appraiser')
          onOpenChange(false)
        } else if (s === 'not_found') {
          setNotFound(true)
        } else {
          toast.error('Could not enrich')
          onOpenChange(false)
        }
      },
      onError: () => toast.error('Could not enrich'),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Enrich from county appraiser</DialogTitle>
          <DialogDescription>
            This property needs a parcel ID and county first — the appraiser then fills in
            owner, size, zoning and coordinates.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="enrich-county">County</Label>
            <Select
              value={county}
              onValueChange={(v) => {
                setCounty(v)
                setParcel((p) => formatParcelId(p, v))
              }}
            >
              <SelectTrigger id="enrich-county" className="w-full">
                <SelectValue placeholder="Select county" />
              </SelectTrigger>
              <SelectContent>
                {ENRICHABLE_COUNTIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="enrich-parcel">Parcel ID</Label>
            <Input
              id="enrich-parcel"
              value={parcel}
              onChange={(e) => setParcel(e.target.value)}
              onBlur={() => setParcel((p) => formatParcelId(p, county))}
              placeholder="paste raw — we format it"
              autoFocus
              autoComplete="off"
            />
            {notFound && (
              <p className="text-xs font-medium text-amber-700">
                No matching parcel at the {county} appraiser — check the ID and try again.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? 'Enriching…' : 'Save & enrich'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
