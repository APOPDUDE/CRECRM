import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { CompanySelect } from '@/components/company-select'
import { ContactSelect } from '@/components/contact-select'
import { leadSourceLabels } from '@/components/source-badge'
import {
  BuyerCriteriaFields,
  buyerCriteriaToRow,
  emptyBuyerCriteria,
} from '@/components/buyer-criteria-fields'
import type { BuyerCriteria } from '@/components/buyer-criteria-fields'
import { useAuth } from '@/hooks/use-auth'
import { useCreateTenantRep } from '@/hooks/use-tenant-reps'
import type { Enums } from '@/lib/database.types'
import { friendlyDbError } from '@/lib/db-errors'

const NONE = '__none__'

/**
 * Add a buyer to the roster. A buyer is a client with deal_type 'sale' — the same record
 * a tenant rep uses, so the moment they go after a property the existing deal board works.
 */
export function AddBuyerDialog({
  open,
  onOpenChange,
  prefill,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Seed the form when the buyer came from somewhere that already knows who they are —
   * today that's the GHL buyer-tag queue on the Buyers page.
   */
  prefill?: {
    contactId?: string | null
    companyId?: string | null
    /** Shown on the contact picker, which can't always resolve a name from its capped list. */
    contactLabel?: string | null
  } | null
  /** The client that was just created, so a caller can link its queue entry to it. */
  onCreated?: (clientId: string) => void
}) {
  const { session } = useAuth()
  const userId = session?.user.id
  const createClient = useCreateTenantRep()

  const [contactId, setContactId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [source, setSource] = useState<string>(NONE)
  const [capRate, setCapRate] = useState('')
  const [notes, setNotes] = useState('')
  const [criteria, setCriteria] = useState<BuyerCriteria>(emptyBuyerCriteria)

  useEffect(() => {
    if (!open) return
    setContactId(prefill?.contactId ?? null)
    setCompanyId(prefill?.companyId ?? null)
    setSource(NONE)
    setCapRate('')
    setNotes('')
    setCriteria(emptyBuyerCriteria())
  }, [open, prefill?.contactId, prefill?.companyId])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!contactId || !userId) return
    createClient.mutate(
      {
        owner_id: userId,
        contact_id: contactId,
        company_id: companyId,
        is_rep: true,
        deal_type: 'sale',
        status: 'prospect',
        source: source === NONE ? null : (source as Enums<'lead_source'>),
        cap_rate_min: capRate.trim() === '' ? null : Number(capRate),
        must_haves: notes.trim() || null,
        ...buyerCriteriaToRow(criteria),
      },
      {
        onSuccess: (created) => {
          toast.success('Buyer added')
          if (created?.id) onCreated?.(created.id)
          onOpenChange(false)
        },
        onError: (error) => toast.error(friendlyDbError(error, 'Could not add buyer')),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add buyer</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Contact</Label>
            <ContactSelect
              value={contactId}
              onChange={setContactId}
              companyId={companyId ?? undefined}
              placeholder="Select or create contact"
              fallbackLabel={contactId && contactId === prefill?.contactId ? prefill?.contactLabel : null}
            />
          </div>
          <div className="space-y-2">
            <Label>Company</Label>
            <CompanySelect
              value={companyId}
              onChange={setCompanyId}
              defaultType="other"
              placeholder="Select or create company"
            />
          </div>

          <BuyerCriteriaFields value={criteria} onChange={setCriteria} idPrefix="add-buyer" />

          <div className="space-y-2">
            <Label htmlFor="add-buyer-cap">Min cap rate (%)</Label>
            <Input
              id="add-buyer-cap"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={capRate}
              onChange={(e) => setCapRate(e.target.value)}
              placeholder="e.g. 6.5"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-buyer-source">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger id="add-buyer-source" className="w-full">
                <SelectValue placeholder="No source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No source</SelectItem>
                {Object.entries(leadSourceLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-buyer-notes">Notes</Label>
            <Textarea
              id="add-buyer-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Tenancy, hold period, debt, whatever matters when you call them…"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createClient.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createClient.isPending || !contactId}>
              {createClient.isPending ? 'Adding…' : 'Add buyer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
