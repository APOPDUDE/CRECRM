import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { format } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
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
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { CompanySelect } from '@/components/company-select'
import { ContactSelect } from '@/components/contact-select'
import { leadSourceLabels } from '@/components/source-badge'
import { useUnits, useSetPursuitUnits, unitSizeLabel } from '@/hooks/use-units'
import { formatPsf } from '@/lib/format'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'

const NONE = '__none__'
type MakeRep = 'no' | 'lease' | 'sale' | 'both'

interface AddTenantMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  propertyId: string
}

export function AddTenantMatchDialog({
  open,
  onOpenChange,
  propertyId,
}: AddTenantMatchDialogProps) {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const setPursuitUnits = useSetPursuitUnits()
  const { data: allUnits = [] } = useUnits([propertyId])
  const availableUnits = allUnits.filter((u) => u.status === 'available')
  const [pending, setPending] = useState(false)
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([])

  // company
  const [companyId, setCompanyId] = useState<string | null>(null)
  // contact
  const [contactId, setContactId] = useState<string | null>(null)
  // match
  const [source, setSource] = useState<string>(NONE)
  const [brokerId, setBrokerId] = useState<string | null>(null)
  const [inquiryDate, setInquiryDate] = useState('')
  // tenant rep
  const [makeRep, setMakeRep] = useState<MakeRep>('no')
  const [targetArea, setTargetArea] = useState('')
  const [budget, setBudget] = useState('')
  const [mustHaves, setMustHaves] = useState('')

  useEffect(() => {
    if (!open) return
    setCompanyId(null)
    setContactId(null)
    setSource(NONE)
    setBrokerId(null)
    setInquiryDate(format(new Date(), 'yyyy-MM-dd'))
    setMakeRep('no')
    setTargetArea('')
    setBudget('')
    setMustHaves('')
    setSelectedUnitIds([])
  }, [open])

  const toggleUnit = (id: string) =>
    setSelectedUnitIds((cur) => (cur.includes(id) ? cur.filter((u) => u !== id) : [...cur, id]))

  const isBroker = source === 'broker'
  const sourceVal = source === NONE ? null : (source as Enums<'lead_source'>)
  // a pursuit always points at a client, so a contact is required (a prospect IS a client)
  const canSubmit = !!contactId && (!isBroker || !!brokerId)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!session?.user.id || !contactId) {
      toast.error('A contact is required')
      return
    }
    setPending(true)
    try {
      // find-or-create the client for this contact ('no' makes a passive prospect)
      let clientId: string | null = null
      const { data: existing } = await supabase
        .from('clients')
        .select('id')
        .eq('owner_id', session.user.id)
        .eq('contact_id', contactId)
        .in('status', ['prospect', 'searching', 'negotiating'])
        .limit(1)
        .maybeSingle()
      if (existing) {
        clientId = existing.id
        if (makeRep !== 'no') {
          await supabase
            .from('clients')
            .update({ status: 'searching', deal_type: makeRep, is_rep: true })
            .eq('id', clientId)
        }
      } else {
        const { data: c, error: cErr } = await supabase
          .from('clients')
          .insert({
            owner_id: session.user.id,
            company_id: companyId,
            contact_id: contactId,
            status: makeRep === 'no' ? 'prospect' : 'searching',
            is_rep: makeRep !== 'no',
            deal_type: makeRep === 'no' ? 'lease' : makeRep,
            source: sourceVal,
            broker_contact_id: isBroker ? brokerId : null,
            target_markets: targetArea.trim() || null,
            budget: budget.trim() || null,
            must_haves: mustHaves.trim() || null,
          })
          .select('id')
          .single()
        if (cErr) throw cErr
        clientId = c.id
      }

      // open the pursuit on this property (links to the landlord board via property_id)
      const { data: pursuit, error: mErr } = await supabase
        .from('pursuits')
        .insert({
          property_id: propertyId,
          client_id: clientId,
          owner_id: session.user.id,
          inquiry_date: inquiryDate || undefined,
        })
        .select('id')
        .single()
      if (mErr) throw mErr

      // record which available unit(s) they inquired on
      if (pursuit && selectedUnitIds.length > 0) {
        await setPursuitUnits.mutateAsync({ pursuitId: pursuit.id, unitIds: selectedUnitIds })
      }

      for (const key of ['matches', 'listings', 'tenant_reps', 'companies', 'contacts']) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
      toast.success(makeRep !== 'no' ? 'Tenant added & repping' : 'Tenant added')
      onOpenChange(false)
    } catch (error) {
      toast.error(friendlyDbError(error, 'Could not add tenant'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add tenant</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Company */}
          <div className="space-y-2">
            <Label>Company</Label>
            <CompanySelect
              value={companyId}
              onChange={setCompanyId}
              defaultType="tenant"
              placeholder="Select or create company"
            />
          </div>

          {/* Contact */}
          <div className="space-y-2">
            <Label>Contact</Label>
            <ContactSelect
              value={contactId}
              onChange={setContactId}
              companyId={companyId}
              placeholder="Select or create contact"
            />
          </div>

          {/* Units they inquired on (multi-tenant properties) */}
          {availableUnits.length > 0 && (
            <div className="space-y-2">
              <Label>Units inquired on</Label>
              <div className="space-y-0.5 rounded-lg border p-2">
                {availableUnits.map((u) => (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm hover:bg-accent/50"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedUnitIds.includes(u.id)}
                      onCheckedChange={() => toggleUnit(u.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{u.label || unitSizeLabel(u)}</span>
                      {(u.label || u.asking_rate_psf != null) && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {[
                            u.label ? unitSizeLabel(u) : null,
                            u.asking_rate_psf != null ? formatPsf(u.asking_rate_psf) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Pick the unit(s) they're interested in — choose multiple for land or several spaces.
              </p>
            </div>
          )}

          {/* Match basics */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="match-source">Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger id="match-source" className="w-full">
                  <SelectValue placeholder="No source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No source</SelectItem>
                  {Object.entries(leadSourceLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="match-inquiry-date">Inquiry date</Label>
              <Input
                id="match-inquiry-date"
                type="date"
                value={inquiryDate}
                onChange={(e) => setInquiryDate(e.target.value)}
              />
            </div>
          </div>
          {isBroker && (
            <div className="space-y-2">
              <Label>Referring broker</Label>
              <ContactSelect value={brokerId} onChange={setBrokerId} placeholder="Select or create broker" />
            </div>
          )}

          <Separator />

          {/* Make tenant rep? */}
          <div className="space-y-2">
            <Label htmlFor="make-rep">Make tenant rep?</Label>
            <Select value={makeRep} onValueChange={(v) => setMakeRep(v as MakeRep)}>
              <SelectTrigger id="make-rep" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No — just a prospect on this listing</SelectItem>
                <SelectItem value="lease">Yes — represent them (leasing)</SelectItem>
                <SelectItem value="sale">Yes — represent them (buying)</SelectItem>
                <SelectItem value="both">Yes — represent them (lease or buy)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {makeRep !== 'no' && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">Search requirements</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rep-area" className="text-xs">Target area</Label>
                  <Input id="rep-area" value={targetArea} onChange={(e) => setTargetArea(e.target.value)} placeholder="e.g. Tampa / Hwy 92" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rep-budget" className="text-xs">Budget</Label>
                  <Input id="rep-budget" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. $12–14 PSF NNN" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rep-musthaves" className="text-xs">Requirements / must-haves</Label>
                <Textarea id="rep-musthaves" rows={2} value={mustHaves} onChange={(e) => setMustHaves(e.target.value)} placeholder="Size, docks, power, clear height…" />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !canSubmit}>
              {pending ? 'Adding…' : 'Add tenant'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
