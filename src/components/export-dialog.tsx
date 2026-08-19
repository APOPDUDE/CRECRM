import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ALL_EXPORT_COLUMN_IDS,
  EXPORT_COLUMNS,
  EXPORT_GROUPS,
  LEASE_EXPORT_COLUMN_IDS,
  type ExportGroup,
} from '@/lib/export-columns'
import { useUserPref } from '@/hooks/use-user-prefs'
import { downloadCsv, toCsv, todayStamp } from '@/lib/export-csv'
import { supabase } from '@/lib/supabase'
import type { PropertyWithCounts } from '@/hooks/use-properties'
import type { OwnerContext } from '@/hooks/use-owners'
import type { CurrentAsking } from '@/hooks/use-comps'
import type { LeaseComp } from '@/hooks/use-lease-comps'

type Preset = { name: string; columns: string[] }

/** Owner identity for the dedupe: the owning company, else the county's owner name. */
function ownerKey(p: PropertyWithCounts): string | null {
  if (p.owner_company_id) return p.owner_company_id
  const name = (p.owner_name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return name || null
}

/**
 * The one export dialog (War Room overhaul Phase 4), replacing the per-lens CSVs.
 * Opens with every column checked — Alex unchecks what he doesn't want — plus saved
 * presets, the one-row-per-owner skip-trace dedupe (shown only when the set actually
 * holds duplicate owners), and an explicit switch for the skip-trace stamp so a
 * research export never quietly marks owners as sent.
 */
type ExportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The filtered set — exactly what the count line and Export button promise. */
  rows: PropertyWithCounts[]
  ownerCtx?: Map<string, OwnerContext>
  asking?: Map<string, CurrentAsking>
  /** The representative lease per property (the window's match, else soonest-running). */
  getLease: (propertyId: string) => LeaseComp | undefined
  /** Fired when lease columns are checked — the parent starts the comps fetch. */
  onLeaseNeeded: () => void
  crossovers?: Set<string>
}

export function ExportDialog(props: ExportDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* The body mounts fresh per open, so every open starts with everything checked
          (the accept criterion) — presets are the memory, not last time's unchecking. */}
      {props.open && <ExportDialogBody {...props} />}
    </Dialog>
  )
}

function ExportDialogBody({
  open,
  onOpenChange,
  rows,
  ownerCtx,
  asking,
  getLease,
  onLeaseNeeded,
  crossovers,
}: ExportDialogProps) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(ALL_EXPORT_COLUMN_IDS))

  // Presets live server-side (`user_prefs`) so the phone sees them too. Anything saved
  // by the localStorage-only first version migrates up once, then the local key dies —
  // two sources of truth would drift.
  const { value: presets, loaded: presetsLoaded, save: setPresets } = useUserPref<Preset[]>('export_presets', [])
  const safePresets = Array.isArray(presets) ? presets.filter((p) => p && typeof p.name === 'string') : []
  useEffect(() => {
    if (!presetsLoaded || safePresets.length > 0) return
    try {
      const local = JSON.parse(window.localStorage.getItem('properties:exportPresets') ?? 'null') as Preset[] | null
      if (Array.isArray(local) && local.length > 0) setPresets(local)
      window.localStorage.removeItem('properties:exportPresets')
    } catch {
      // an unreadable legacy value is not worth blocking presets over
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetsLoaded])
  const [presetName, setPresetName] = useState('')

  const [dedupe, setDedupe] = useState(false)
  const [stamp, setStamp] = useState(true)
  const [exportName, setExportName] = useState('')

  // Lease columns only mean anything once the comps are loaded — ask the parent the
  // moment one is checked, not when the map first opens.
  const anyLeaseChecked = useMemo(
    () => [...checked].some((id) => LEASE_EXPORT_COLUMN_IDS.has(id)),
    [checked],
  )
  useEffect(() => {
    if (open && anyLeaseChecked) onLeaseNeeded()
  }, [open, anyLeaseChecked, onLeaseNeeded])

  /**
   * The dedupe arithmetic. Anchor = each owner's LARGEST building (gross_sf, then
   * acres): the best skip-trace conversation starter. Keyless rows (no company, no
   * owner name) can't be duplicates of anything and always export.
   */
  const { ownerCount, dupeCount, dedupedRows } = useMemo(() => {
    const byOwner = new Map<string, PropertyWithCounts>()
    const keyless: PropertyWithCounts[] = []
    let dupes = 0
    for (const p of rows) {
      const key = ownerKey(p)
      if (!key) {
        keyless.push(p)
        continue
      }
      const cur = byOwner.get(key)
      if (!cur) {
        byOwner.set(key, p)
      } else {
        dupes++
        const better =
          (p.gross_sf ?? -1) > (cur.gross_sf ?? -1) ||
          ((p.gross_sf ?? -1) === (cur.gross_sf ?? -1) && (p.land_acres ?? -1) > (cur.land_acres ?? -1))
        if (better) byOwner.set(key, p)
      }
    }
    return {
      ownerCount: byOwner.size + keyless.length,
      dupeCount: dupes,
      dedupedRows: [...byOwner.values(), ...keyless],
    }
  }, [rows])

  const exportRows = dedupe && dupeCount > 0 ? dedupedRows : rows

  const toggleColumn = (id: string) =>
    setChecked((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const setGroup = (group: ExportGroup, on: boolean) =>
    setChecked((cur) => {
      const next = new Set(cur)
      for (const c of EXPORT_COLUMNS) {
        if (c.group !== group) continue
        if (on) next.add(c.id)
        else next.delete(c.id)
      }
      return next
    })

  const applyPreset = (name: string) => {
    const preset = safePresets.find((p) => p.name === name)
    if (preset) setChecked(new Set(preset.columns))
  }

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    setPresets([...safePresets.filter((p) => p.name !== name), { name, columns: [...checked] }])
    setPresetName('')
    toast.success(`Preset “${name}” saved`)
  }

  const runExport = () => {
    const cols = EXPORT_COLUMNS.filter((c) => checked.has(c.id))
    if (cols.length === 0 || exportRows.length === 0) return
    const csvRows = exportRows.map((p) => {
      const ctx = {
        p,
        o: ownerCtx?.get(p.id),
        ask: asking?.get(p.id),
        lease: getLease(p.id),
        crossovers,
      }
      return cols.map((c) => c.cell(ctx))
    })
    const name = exportName.trim() || `export-${todayStamp()}-${exportRows.length}`
    downloadCsv(`${name}.csv`, toCsv(cols.map((c) => c.label), csvRows))
    if (stamp) {
      // The round-trip record: the import page matches the skiptraced CSV back to this row to
      // report which properties the skiptrace missed. Fire-and-forget, same as the stamp.
      void supabase
        .from('outreach_exports')
        .insert({ name, property_ids: exportRows.map((p) => p.id), row_count: exportRows.length })
        .then(({ error }) => {
          if (error) {
            toast.error(
              error.code === '23505'
                ? `An export named “${name}” already exists — the file downloaded, but pick a new name next time.`
                : 'Export downloaded, but recording it for the import round trip failed.',
            )
          }
        })
    }
    if (stamp) {
      // Stamp the pipeline: these owners are now "out for skip trace". The function
      // marks at COMPANY level, so a deduped export still covers an owner's twin
      // properties. Fire-and-forget — the download must not hinge on the write.
      void supabase
        .rpc('mark_owners_exported', { p_property_ids: exportRows.map((p) => p.id) })
        .then(({ data, error }) => {
          if (error) {
            toast.error('Export downloaded, but marking owners as exported failed.')
          } else {
            const n = (data as { owners_marked?: number } | null)?.owners_marked ?? 0
            if (n > 0) toast.success(`${n} owner${n === 1 ? '' : 's'} marked as exported`)
          }
        })
    }
    onOpenChange(false)
  }

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export CSV</DialogTitle>
          <DialogDescription>
            {rows.length.toLocaleString()} propert{rows.length === 1 ? 'y' : 'ies'} in the
            current set. Everything starts checked — uncheck what you don't want.
          </DialogDescription>
        </DialogHeader>

        {/* presets */}
        <div className="flex flex-wrap items-center gap-2">
          {safePresets.length > 0 && (
            <Select onValueChange={applyPreset}>
              <SelectTrigger className="h-8 w-44">
                <SelectValue placeholder="Apply preset…" />
              </SelectTrigger>
              <SelectContent>
                {safePresets.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name} ({p.columns.length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Save columns as…"
            className="h-8 w-44"
          />
          <Button size="sm" variant="outline" className="h-8" onClick={savePreset} disabled={!presetName.trim()}>
            Save preset
          </Button>
        </div>

        {/* the column groups */}
        <div className="space-y-3">
          {EXPORT_GROUPS.map((group) => {
            const cols = EXPORT_COLUMNS.filter((c) => c.group === group)
            const onCount = cols.filter((c) => checked.has(c.id)).length
            return (
              <div key={group} className="space-y-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={onCount === cols.length ? true : onCount === 0 ? false : 'indeterminate'}
                    onCheckedChange={(v) => setGroup(group, v === true)}
                  />
                  {group}
                  <span className="text-xs font-normal text-muted-foreground">
                    {onCount}/{cols.length}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pl-6 sm:grid-cols-3">
                  {cols.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-1.5 text-xs">
                      <Checkbox checked={checked.has(c.id)} onCheckedChange={() => toggleColumn(c.id)} />
                      <span className="truncate">{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* the skip-trace dedupe — only offered when the set actually holds duplicate owners */}
        {dupeCount > 0 && (
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm">
            <Checkbox checked={dedupe} onCheckedChange={(v) => setDedupe(v === true)} className="mt-0.5" />
            <span>
              One row per owner — {rows.length.toLocaleString()} properties →{' '}
              {ownerCount.toLocaleString()} owners
              <span className="block text-xs text-muted-foreground">
                Keeps each owner's largest building; no point skip-tracing the same owner twice.
              </span>
            </span>
          </label>
        )}

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={stamp} onCheckedChange={(v) => setStamp(v === true)} className="mt-0.5" />
          <span>
            Mark these owners as exported for skip trace
            <span className="block text-xs text-muted-foreground">
              Uncheck for research exports — marked owners are excluded from the next skip-trace list.
            </span>
          </span>
        </label>

        {stamp && (
          <div className="space-y-1">
            <Input
              value={exportName}
              onChange={(e) => setExportName(e.target.value)}
              placeholder={`Name this export… (${`export-${todayStamp()}-${exportRows.length}`})`}
              className="h-8 w-80"
            />
            <p className="text-xs text-muted-foreground">
              The import page will offer this name when the skiptraced CSV comes back, and report
              which of these properties the skiptrace missed.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={runExport} disabled={exportRows.length === 0 || checked.size === 0}>
            Export {exportRows.length.toLocaleString()} row{exportRows.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
    </DialogContent>
  )
}
