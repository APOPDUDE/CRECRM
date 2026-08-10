import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
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
import { CurrencyInput } from '@/components/ui/currency-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { contactNameOf } from '@/hooks/use-contacts'
import { useUpdateMatch } from '@/hooks/use-matches'
import type { MatchWithRelations } from '@/hooks/use-matches'
import { useUpdateTenantRep } from '@/hooks/use-tenant-reps'
import { useProperty } from '@/hooks/use-properties'
import { usePursuitUnits } from '@/hooks/use-units'
import { useUploadFiles } from '@/hooks/use-files'
import type { DealDocTerms } from '@/lib/deal-docs'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables } from '@/lib/database.types'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

interface DraftDocDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  match: MatchWithRelations
  /** loi = the term sheet itself; rfp = tenant-side request to the landlord/broker. */
  docType: 'loi' | 'rfp'
}

/** The property's active listing (if Alex reps it) — landlord + terms prefill. */
function useActiveListingForProperty(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['listing-for-property', propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select(
          `id, asking_rate_psf, asking_price, opex_psf, lease_structure,
           landlord:companies!listings_landlord_company_id_fkey(id, name),
           landlord_contact:contacts!listings_landlord_contact_id_fkey(id, first_name, last_name)`,
        )
        .eq('property_id', propertyId!)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as
        | (Pick<
            Tables<'listings'>,
            'id' | 'asking_rate_psf' | 'asking_price' | 'opex_psf' | 'lease_structure'
          > & {
            landlord: Pick<Tables<'companies'>, 'id' | 'name'> | null
            landlord_contact: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
          })
        | null
    },
  })
}

const toInt = (s: string) => {
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}
const toNum = (s: string) => {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}
const str = (n: number | null | undefined) => (n == null ? '' : String(n))

/**
 * Draft LOI / Draft RFP — prefills everything the CRM knows, asks for the rest,
 * saves every term back to the pursuit (and Use to the client), then generates the
 * Word document, downloads it, and files it under the deal's Files.
 */
export function DraftDocDialog({ open, onOpenChange, match, docType }: DraftDocDialogProps) {
  const isSale = match.deal_type === 'sale'
  const isRfp = docType === 'rfp' && !isSale
  const { data: property } = useProperty(match.property_id)
  const { data: listing } = useActiveListingForProperty(open ? match.property_id : undefined)
  const { data: units = [] } = usePursuitUnits(open ? match.id : undefined)
  const updateMatch = useUpdateMatch()
  const updateClient = useUpdateTenantRep()
  // The generated doc is filed as a copy on every side of the deal — the pursuit,
  // the tenant, and (when Alex reps the property) the listing. files_one_parent
  // allows exactly one parent per row, so each side gets its own copy in its own folder.
  const uploadToPursuit = useUploadFiles('pursuit', match.id)
  const uploadToClient = useUploadFiles('client', match.client_id)
  const uploadToListing = useUploadFiles('listing', listing?.id ?? '')
  const [saving, setSaving] = useState(false)

  const tenantName =
    match.tenant_company?.name ??
    (match.tenant_contact ? contactNameOf(match.tenant_contact) : '')

  // --- form state (strings; parsed on submit) ---
  const [effectiveDate, setEffectiveDate] = useState('')
  const [landlordName, setLandlordName] = useState('')
  const [landlordSigner, setLandlordSigner] = useState('')
  const [recipient, setRecipient] = useState('')
  const [preparedBy, setPreparedBy] = useState('Alex Poplawski — AXIS')
  const [proposedSf, setProposedSf] = useState('')
  const [description, setDescription] = useState('')
  const [intendedUse, setIntendedUse] = useState('')
  const [ratePsf, setRatePsf] = useState('')
  const [structure, setStructure] = useState<string>('none')
  const [opexPsf, setOpexPsf] = useState('')
  const [termMonths, setTermMonths] = useState('')
  const [commencement, setCommencement] = useState('')
  const [escalation, setEscalation] = useState('')
  const [freeRent, setFreeRent] = useState('')
  const [tiAllowance, setTiAllowance] = useState('')
  const [deposit, setDeposit] = useState('')
  const [renewalTerms, setRenewalTerms] = useState('')
  const [specialProvisions, setSpecialProvisions] = useState('')
  const [price, setPrice] = useState('')
  const [earnest, setEarnest] = useState('')
  const [ddDays, setDdDays] = useState('')
  const [closingDays, setClosingDays] = useState('')

  const unitSf = units.find((u) => u.size_sf != null)?.size_sf ?? null
  const unitRate = units.find((u) => u.asking_rate_psf != null)?.asking_rate_psf ?? null

  useEffect(() => {
    if (!open) return
    setEffectiveDate(format(new Date(), 'yyyy-MM-dd'))
    setProposedSf(str(match.proposed_sf ?? unitSf ?? property?.building_sf))
    setDescription(property?.specs ?? '')
    setIntendedUse(match.client?.intended_use ?? '')
    setRatePsf(
      str(match.proposed_rate_psf ?? unitRate ?? listing?.asking_rate_psf ?? match.property?.asking_rate_psf),
    )
    setStructure(match.proposed_lease_structure ?? listing?.lease_structure ?? 'none')
    setOpexPsf(str(match.proposed_opex_psf ?? listing?.opex_psf))
    setTermMonths(str(match.lease_term_months))
    setCommencement(match.proposed_commencement ?? '')
    setEscalation(str(match.escalation_pct))
    setFreeRent(str(match.free_rent_months))
    setTiAllowance(str(match.ti_allowance_psf))
    setDeposit(str(match.security_deposit))
    setRenewalTerms(match.renewal_terms ?? '')
    setSpecialProvisions(match.special_provisions ?? '')
    setPrice(str(match.proposed_price ?? listing?.asking_price ?? match.property?.asking_price))
    setEarnest(str(match.earnest_deposit))
    setDdDays(str(match.dd_days))
    setClosingDays(str(match.closing_days))
    setLandlordName(listing?.landlord?.name ?? '')
    setLandlordSigner(listing?.landlord_contact ? contactNameOf(listing.landlord_contact) : '')
    setRecipient(
      [property?.broker_name, property?.broker_company].filter(Boolean).join(', ') || '',
    )
    // Prefill once per open — listing/property/units land async, so re-run as they arrive.
  }, [open, match, listing, property, unitSf, unitRate])

  const cityStateZip = useMemo(
    () => [property?.city, [property?.state, property?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    [property],
  )

  const pending = saving || updateMatch.isPending || updateClient.isPending

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!match.property?.address && !property?.address) {
      toast.error('This deal has no property address')
      return
    }
    setSaving(true)
    try {
      const structureValue = (structure === 'none' ? null : structure) as Enums<'lease_structure'> | null

      // 1 — the filled terms become deal data (the whole point)
      await updateMatch.mutateAsync({
        id: match.id,
        proposed_sf: toInt(proposedSf),
        proposed_rate_psf: toNum(ratePsf),
        proposed_lease_structure: structureValue,
        proposed_opex_psf: toNum(opexPsf),
        lease_term_months: toInt(termMonths),
        proposed_commencement: commencement || null,
        escalation_pct: toNum(escalation),
        free_rent_months: toInt(freeRent),
        ti_allowance_psf: toNum(tiAllowance),
        security_deposit: toNum(deposit),
        renewal_terms: renewalTerms.trim() || null,
        special_provisions: specialProvisions.trim() || null,
        proposed_price: toNum(price),
        earnest_deposit: toNum(earnest),
        dd_days: toInt(ddDays),
        closing_days: toInt(closingDays),
      })
      if ((intendedUse.trim() || null) !== (match.client?.intended_use ?? null)) {
        await updateClient.mutateAsync({ id: match.client_id, intended_use: intendedUse.trim() || null })
      }

      // 2 — generate the document
      const terms: DealDocTerms = {
        docType: isRfp ? 'rfp' : 'loi',
        dealType: isSale ? 'sale' : 'lease',
        effectiveDate,
        tenantName: tenantName || 'Tenant',
        tenantContactName: match.tenant_contact ? contactNameOf(match.tenant_contact) : null,
        landlordName: landlordName.trim() || null,
        landlordContactName: landlordSigner.trim() || null,
        address: property?.address ?? match.property?.address ?? '',
        cityStateZip: cityStateZip || null,
        additionalDescription: description.trim() || null,
        proposedSf: toInt(proposedSf),
        intendedUse: intendedUse.trim() || null,
        ratePsf: toNum(ratePsf),
        leaseStructure: structureValue,
        opexPsf: toNum(opexPsf),
        termMonths: toInt(termMonths),
        commencement: commencement || null,
        escalationPct: toNum(escalation),
        freeRentMonths: toInt(freeRent),
        tiAllowancePsf: toNum(tiAllowance),
        securityDeposit: toNum(deposit),
        renewalTerms: renewalTerms.trim() || null,
        specialProvisions: specialProvisions.trim() || null,
        proposedPrice: toNum(price),
        earnestDeposit: toNum(earnest),
        ddDays: toInt(ddDays),
        closingDays: toInt(closingDays),
        recipient: recipient.trim() || null,
        preparedBy: preparedBy.trim() || 'Alex Poplawski — AXIS',
        stateCode: property?.state ?? match.property?.state ?? null,
      }
      // docx is heavy — pulled in only when a document is actually generated
      const { buildDealDoc, dealDocFileName } = await import('@/lib/deal-docs')
      const blob = await buildDealDoc(terms)
      const fileName = dealDocFileName(terms)

      // 3 — download for immediate use
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)

      // 4 — file a copy on every side of the deal (each lands in its Finder folder via sync)
      const file = new File([blob], fileName, { type: DOCX_MIME })
      const category = isRfp ? ('rfp' as const) : ('loi' as const)
      const targets: { label: string; upload: typeof uploadToPursuit }[] = [
        { label: 'deal', upload: uploadToPursuit },
        { label: 'tenant', upload: uploadToClient },
        ...(listing ? [{ label: 'listing', upload: uploadToListing }] : []),
      ]
      const failedAt: string[] = []
      for (const t of targets) {
        try {
          const result = await t.upload.mutateAsync({ files: [file], category })
          if (result.failed.length > 0) failedAt.push(t.label)
        } catch {
          failedAt.push(t.label)
        }
      }
      if (failedAt.length === targets.length) {
        toast.warning('Document downloaded, but saving it to Files failed')
      } else if (failedAt.length > 0) {
        toast.warning(`${isRfp ? 'RFP' : 'LOI'} drafted — but filing to the ${failedAt.join(' and ')} failed`)
      } else {
        toast.success(
          `${isRfp ? 'RFP' : 'LOI'} drafted — downloaded and filed on the ${targets
            .map((t) => t.label)
            .join(', ')}`,
        )
      }
      onOpenChange(false)
    } catch {
      toast.error(`Could not draft the ${isRfp ? 'RFP' : 'LOI'}`)
    } finally {
      setSaving(false)
    }
  }

  const docLabel = isRfp ? 'RFP' : 'LOI'
  const address = property?.address ?? match.property?.address ?? 'the property'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Draft {docLabel}</DialogTitle>
          <DialogDescription>
            {isRfp
              ? `Request a proposal for ${tenantName || 'the tenant'} at ${address}. Everything you fill in is saved on the deal.`
              : `${tenantName || 'Tenant'} at ${address}. Everything you fill in is saved on the deal.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="doc-date">{isRfp ? 'Date' : 'Effective date'}</Label>
                <Input
                  id="doc-date"
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-sf">Size (SF)</Label>
                <CurrencyInput
                  id="doc-sf"
                  placeholder="e.g. 10000"
                  value={proposedSf}
                  onValueChange={setProposedSf}
                />
              </div>
            </div>

            {isRfp ? (
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="doc-to">To (landlord / listing broker)</Label>
                  <Input
                    id="doc-to"
                    placeholder="e.g. Jane Doe, CBRE"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="doc-from">From</Label>
                  <Input id="doc-from" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="doc-llc">{isSale ? 'Seller' : 'Landlord (Lessor)'}</Label>
                  <Input
                    id="doc-llc"
                    placeholder="Company or owner name"
                    value={landlordName}
                    onChange={(e) => setLandlordName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="doc-lls">{isSale ? 'Seller signer' : 'Lessor signer'}</Label>
                  <Input
                    id="doc-lls"
                    placeholder="Who signs"
                    value={landlordSigner}
                    onChange={(e) => setLandlordSigner(e.target.value)}
                  />
                </div>
              </div>
            )}

            {!isSale && (
              <div className="space-y-2">
                <Label htmlFor="doc-use">Tenant&apos;s use of the premises</Label>
                <Input
                  id="doc-use"
                  placeholder="e.g. warehousing and distribution of building materials"
                  value={intendedUse}
                  onChange={(e) => setIntendedUse(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Saved on the tenant for future deals.</p>
              </div>
            )}

            {isSale ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="doc-price">Purchase price ($)</Label>
                  <CurrencyInput
                    id="doc-price"
                    value={price}
                    onValueChange={setPrice}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="doc-earnest">Earnest deposit ($)</Label>
                  <CurrencyInput
                    id="doc-earnest"
                    value={earnest}
                    onValueChange={setEarnest}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="doc-dd">Due diligence (days)</Label>
                  <Input
                    id="doc-dd"
                    type="number"
                    min={1}
                    placeholder="e.g. 30"
                    value={ddDays}
                    onChange={(e) => setDdDays(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="doc-close">Closing after DD (days)</Label>
                  <Input
                    id="doc-close"
                    type="number"
                    min={1}
                    placeholder="e.g. 30"
                    value={closingDays}
                    onChange={(e) => setClosingDays(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="doc-rate">Base rent ($/SF/yr)</Label>
                    <CurrencyInput
                      id="doc-rate"
                      value={ratePsf}
                      onValueChange={setRatePsf}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Lease structure</Label>
                    <Select value={structure} onValueChange={setStructure}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Structure" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not specified</SelectItem>
                        <SelectItem value="NNN">NNN</SelectItem>
                        <SelectItem value="NN">NN</SelectItem>
                        <SelectItem value="MG">Modified gross</SelectItem>
                        <SelectItem value="FS">Full service</SelectItem>
                        <SelectItem value="IG">Industrial gross</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="doc-opex">Opex ($/SF/yr)</Label>
                    <CurrencyInput
                      id="doc-opex"
                      value={opexPsf}
                      onValueChange={setOpexPsf}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="doc-esc">Annual increases (%)</Label>
                    <Input
                      id="doc-esc"
                      type="number"
                      min={0}
                      step="any"
                      placeholder="e.g. 3"
                      value={escalation}
                      onChange={(e) => setEscalation(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="doc-term">Term (months)</Label>
                    <Input
                      id="doc-term"
                      type="number"
                      min={1}
                      placeholder="e.g. 60"
                      value={termMonths}
                      onChange={(e) => setTermMonths(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="doc-comm">Commencement</Label>
                    <Input
                      id="doc-comm"
                      type="date"
                      value={commencement}
                      onChange={(e) => setCommencement(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="doc-free">Free rent (months)</Label>
                    <Input
                      id="doc-free"
                      type="number"
                      min={0}
                      value={freeRent}
                      onChange={(e) => setFreeRent(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="doc-ti">TI allowance ($/SF)</Label>
                    <CurrencyInput
                      id="doc-ti"
                      value={tiAllowance}
                      onValueChange={setTiAllowance}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="doc-dep">Security deposit ($)</Label>
                    <CurrencyInput
                      id="doc-dep"
                      value={deposit}
                      onValueChange={setDeposit}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="doc-renew">Renewal options</Label>
                  <Input
                    id="doc-renew"
                    placeholder='e.g. "Two 5-year options at market, 180 days notice"'
                    value={renewalTerms}
                    onChange={(e) => setRenewalTerms(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="doc-desc">Additional description of the premises</Label>
              <Textarea
                id="doc-desc"
                rows={2}
                placeholder="Suite, condition, included yard space…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-special">
                {isRfp ? 'Additional items to request' : 'Additional provisions'}
              </Label>
              <Textarea
                id="doc-special"
                rows={2}
                value={specialProvisions}
                onChange={(e) => setSpecialProvisions(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Drafting…' : `Generate ${docLabel}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
