import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatCurrency } from '@/lib/format'

export type EnrichChanges = Record<string, { from: unknown; to: unknown }>

const LABELS: Record<string, string> = {
  owner_name: 'Owner',
  owner_mailing_address: 'Owner mailing address',
  just_value: 'Just value',
  assessed_value: 'Assessed value',
  dor_use_code: 'DOR use code',
  site_address: 'Site address',
  address: 'Address',
  folio: 'Folio',
  parcel_number: 'Parcel',
  county: 'County',
  last_sale_date: 'Last sale date',
  last_sale_price: 'Last sale price',
  gross_sf: 'Gross SF',
  heated_sf: 'Heated SF',
  year_built: 'Year built',
  land_acres: 'Acres',
  zoning_description: 'Zoning',
  lat: 'Latitude',
  lng: 'Longitude',
}
const MONEY = new Set(['just_value', 'assessed_value', 'last_sale_price'])
const ORDER = Object.keys(LABELS)

function show(k: string, v: unknown): string {
  if (v == null || v === '') return '—'
  if (MONEY.has(k)) return formatCurrency(Number(v)) ?? String(v)
  if (k === 'gross_sf' || k === 'heated_sf') return `${Number(v).toLocaleString()} SF`
  if (k === 'land_acres') return `${v} AC`
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(6)
  return String(v)
}

/**
 * What the county appraiser changed on Refresh (Alex 2026-09-05: "if anything new is
 * detected I want a popup saying what changed"). The function returns only the columns
 * whose value actually moved; nothing moved = a toast, not this dialog.
 */
export function EnrichChangesDialog({
  changes,
  onOpenChange,
}: {
  changes: EnrichChanges | null
  onOpenChange: (open: boolean) => void
}) {
  const keys = changes ? ORDER.filter((k) => k in changes).concat(Object.keys(changes).filter((k) => !ORDER.includes(k))) : []
  return (
    <Dialog open={changes != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>County appraiser: {keys.length} change{keys.length === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>What the county now says versus what this property had.</DialogDescription>
        </DialogHeader>
        <dl className="max-h-80 space-y-2 overflow-y-auto text-sm">
          {keys.map((k) => (
            <div key={k} className="grid grid-cols-[9rem_1fr] gap-2">
              <dt className="text-muted-foreground">{LABELS[k] ?? k}</dt>
              <dd className="min-w-0">
                <span className="text-muted-foreground line-through decoration-muted-foreground/60">{show(k, changes![k].from)}</span>
                <span className="mx-1.5 text-muted-foreground">→</span>
                <span className="font-medium">{show(k, changes![k].to)}</span>
              </dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
