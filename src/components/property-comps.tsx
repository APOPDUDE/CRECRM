import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CompEditDialog } from '@/components/comp-edit-dialog'
import { usePropertyComps, useDeleteComp, type PropertyComp } from '@/hooks/use-comps'
import { clientLabel } from '@/hooks/use-suggestions'
import { formatCurrency, formatPsf } from '@/lib/format'
import { formatDate } from '@/lib/dates'

/** One-line summary: leases show base -> opex -> all-in/mo; sales show price -> $/SF. */
function compMetrics(c: PropertyComp): string {
  const parts: (string | null)[] = []
  if (c.deal_type === 'sale') {
    parts.push(formatCurrency(c.sale_price))
    if (c.sale_price != null && c.sf) parts.push(`${formatPsf(c.sale_price / c.sf)} /SF`)
    if (c.cap_rate_pct != null) parts.push(`${c.cap_rate_pct}% cap`)
  } else {
    const rate = c.kind === 'asking' ? c.asking_lease_rate_psf : c.executed_lease_rate_psf
    if (rate != null) parts.push(`${formatPsf(rate)} base`)
    if (c.opex_psf != null) parts.push(`+${formatPsf(c.opex_psf)} opex`)
    if (rate != null && c.sf) {
      const allIn = ((rate + (c.opex_psf ?? 0)) * c.sf) / 12
      parts.push(`${formatCurrency(allIn)}/mo all-in`)
    }
    if (c.lease_structure) parts.push(c.lease_structure)
    if (c.term_months != null) parts.push(`${c.term_months} mo`)
    if (c.free_rent_months != null) parts.push(`${c.free_rent_months} mo free`)
    if (c.ti_psf != null) parts.push(`$${c.ti_psf} TI`)
  }
  if (c.commission_fee != null) parts.push(`${formatCurrency(c.commission_fee)} fee`)
  return parts.filter(Boolean).join(' · ')
}

function CompList({
  propertyId,
  kind,
  comps,
}: {
  propertyId: string
  kind: 'asking' | 'executed'
  comps: PropertyComp[]
}) {
  const del = useDeleteComp()
  const [editing, setEditing] = useState<PropertyComp | null>(null)
  const [adding, setAdding] = useState(false)
  const title = kind === 'asking' ? 'Asking comps' : 'Executed comps'

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          {title} {comps.length > 0 && `(${comps.length})`}
        </h2>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          Add
        </Button>
      </div>
      {comps.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No {kind} comps yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {comps.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge
                    variant="outline"
                    className={
                      kind === 'executed'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-blue-200 bg-blue-50 text-blue-700'
                    }
                  >
                    {c.deal_type === 'sale' ? 'Sale' : 'Lease'}
                  </Badge>
                  <span className="font-medium">{compMetrics(c) || '—'}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(c.as_of_date ?? c.executed_at) ?? 'No date'}
                  {kind === 'executed' && c.pursuit?.client ? ` · ${clientLabel(c.pursuit.client)}` : ''}
                  {c.source === 'scrape' ? ' · scraped' : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setEditing(c)}
                  title="Edit"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => del.mutate(c.id)}
                  title="Delete"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <CompEditDialog open={adding} onOpenChange={setAdding} propertyId={propertyId} kind={kind} />
      <CompEditDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        propertyId={propertyId}
        kind={kind}
        comp={editing}
      />
    </section>
  )
}

/**
 * Two property widgets: Asking comps + Executed comps, each a dated history with
 * add/edit/delete. Asking = market history; executed = closed-deal terms + commission.
 */
export function PropertyComps({ propertyId }: { propertyId: string }) {
  const { data: comps = [] } = usePropertyComps(propertyId)
  const asking = comps.filter((c) => c.kind === 'asking')
  const executed = comps.filter((c) => c.kind === 'executed')
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <CompList propertyId={propertyId} kind="asking" comps={asking} />
      <CompList propertyId={propertyId} kind="executed" comps={executed} />
    </div>
  )
}
