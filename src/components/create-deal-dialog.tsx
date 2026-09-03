import { useState } from 'react'
import { useResetOn } from '@/hooks/use-reset-on'
import type { FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
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
import { useAuth } from '@/hooks/use-auth'
import { useCreateProperty, useEnrichProperty } from '@/hooks/use-properties'
import { useCreateListing } from '@/hooks/use-listings'
import { useUpsertContactByPhone } from '@/hooks/use-contacts'
import { useAddVerifiedContact } from '@/hooks/use-owners'
import type { DealRadarRow } from '@/hooks/use-deal-radar'
import { contactCategoryLabels } from '@/lib/contact-category'
import { friendlyDbError } from '@/lib/db-errors'
import { ENRICHABLE_COUNTIES, formatParcelId } from '@/lib/parcel'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'

interface CreateDealDialogProps {
  row: DealRadarRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a deal is created so the parent can refresh / close the detail. */
  onCreated?: () => void
}

interface ParcelRow {
  county: string
  parcel: string
}

/**
 * Turn a Facebook radar listing into a real deal: create a property per parcel,
 * run the county appraiser enhancer, optionally attach a typed contact (an
 * `owner` becomes the property's VERIFIED OWNER), open a prospect (the app's
 * standalone lead — not a landlord/tenant-rep deal), and mark the radar row
 * converted + linked. Enrichment / verify / prospect are best-effort so the
 * core (property + link) always lands.
 */
export function CreateDealDialog({ row, open, onOpenChange, onCreated }: CreateDealDialogProps) {
  const { session } = useAuth()
  const userId = session?.user.id
  const createProperty = useCreateProperty()
  const createListing = useCreateListing()
  const enrich = useEnrichProperty()
  const upsertContact = useUpsertContactByPhone()
  const addVerifiedOwner = useAddVerifiedContact()

  const [address, setAddress] = useState('')
  const [parcels, setParcels] = useState<ParcelRow[]>([{ county: '', parcel: '' }])
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [type, setType] = useState<Enums<'contact_category'>>('owning_entity')
  const [dealKind, setDealKind] = useState<'lead' | 'landlord'>('lead')
  const [busy, setBusy] = useState(false)

  useResetOn([open, row?.id], () => {
    if (open && row) {
      // Radar location_text is roughly "City, Florida" — seed the address field with it.
      setAddress(row.location_text ?? '')
      setParcels([{ county: '', parcel: '' }])
      setFirst('')
      setLast('')
      setPhone('')
      setEmail('')
      setType('owning_entity')
      setDealKind('lead')
      setBusy(false)
    }
  })

  if (!row) return null

  const city = row.location_text?.split(',')[0]?.trim() || null
  const propertyType: Enums<'property_kind'> = row.listing_type === 'land' ? 'land' : 'industrial'
  const validParcels = parcels.filter((p) => p.county && p.parcel.trim())
  const hasContact = !!(first.trim() || phone.trim())
  const canSubmit = !!userId && !!address.trim() && validParcels.length > 0 && !busy

  function setParcel(i: number, patch: Partial<ParcelRow>) {
    setParcels((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || !userId) return
    setBusy(true)
    try {
      // 1. A property per parcel, each enriched from the county appraiser. Per-parcel
      //    guarded so one bad parcel doesn't abort the rest (or orphan the others).
      const propertyIds: string[] = []
      for (const p of validParcels) {
        try {
          const created = await createProperty.mutateAsync({
            address: address.trim(),
            city,
            state: 'FL',
            parcel_number: formatParcelId(p.parcel, p.county),
            county: p.county,
            property_type: propertyType,
            lat: row!.lat,
            lng: row!.lng,
          })
          propertyIds.push(created.id)
          try {
            await enrich.mutateAsync(created.id)
          } catch {
            /* enrichment is best-effort — a bad/unknown parcel shouldn't block the deal */
          }
        } catch (err) {
          toast.error(friendlyDbError(err, `Could not add parcel ${p.parcel}`))
        }
      }
      if (propertyIds.length === 0) throw new Error('No property could be created — check the parcel + county')
      const primaryId = propertyIds[0]

      // 2. Owner data lands on the property during enrichment.
      const { data: primary } = await supabase
        .from('properties')
        .select('id, owner_company_id, owner_name, parcel_number, address, city')
        .eq('id', primaryId)
        .single()

      // 3. Optional contact — an `owner` becomes the property's verified owner.
      //    Everything past the property is BEST-EFFORT: the radar link (step 5) must
      //    still land, so a contact/prospect hiccup never leaves the property orphaned.
      let contactId: string | null = null
      let ownerCompanyId = primary?.owner_company_id ?? null
      if (hasContact) {
        try {
          if (type === 'owning_entity' && phone.trim() && primary) {
            await addVerifiedOwner.mutateAsync({
              property: {
                parcel_number: primary.parcel_number,
                address: primary.address,
                city: primary.city,
                owner_name: primary.owner_name,
              },
              first: first.trim() || primary.owner_name || 'Owner',
              last: last.trim() || null,
              phone: phone.trim(),
              email: email.trim() || null,
            })
            // ghl_verify_owner seats the owner on the property's company; re-read it.
            const { data: after } = await supabase
              .from('properties')
              .select('owner_company_id')
              .eq('id', primaryId)
              .single()
            ownerCompanyId = after?.owner_company_id ?? ownerCompanyId
          } else {
            const c = await upsertContact.mutateAsync({
              first_name: first.trim() || 'Unknown',
              last_name: last.trim() || null,
              phone: phone.trim() || null,
              email: email.trim() || null,
              category: type,
            })
            contactId = c.id
          }
        } catch (err) {
          toast.error(friendlyDbError(err, 'Deal created, but the contact step failed'))
        }
      }

      // 4. The deal record — best-effort so the radar link (step 5) always lands.
      if (dealKind === 'landlord') {
        // Landlord rep: a listing on this property, the owner as landlord. deal_type
        // follows the listing's intent (unknown -> both, i.e. for lease or sale).
        try {
          await createListing.mutateAsync({
            owner_id: userId,
            property_id: primaryId,
            deal_type:
              row!.listing_intent === 'lease' ? 'lease' : row!.listing_intent === 'sale' ? 'sale' : 'both',
            landlord_company_id: ownerCompanyId,
            landlord_contact_id: contactId,
          })
        } catch (err) {
          toast.error(friendlyDbError(err, 'Property added, but the landlord listing was not created'))
        }
      } else if (contactId || ownerCompanyId) {
        // Lead: a standalone prospect. Needs a contact or a company — the typed contact,
        // else the county-found owner company. Skip if neither.
        try {
          const { data: prospect, error: pErr } = await supabase
            .from('prospects')
            .insert({
              owner_id: userId,
              contact_id: contactId,
              company_id: contactId ? null : ownerCompanyId,
              description: row!.title,
              lead_type: 'deal_radar',
            })
            .select('id')
            .single()
          if (pErr) throw pErr
          await supabase
            .from('prospect_properties')
            .insert(propertyIds.map((property_id) => ({ prospect_id: prospect.id, property_id })))
        } catch (err) {
          toast.error(friendlyDbError(err, 'Deal created, but the lead was not opened'))
        }
      }

      // 5. Mark the radar row converted + linked — always runs once a property exists.
      await supabase
        .from('deal_radar')
        .update({ status: 'converted', property_id: primaryId, contact_id: contactId })
        .eq('id', row!.id)

      toast.success(dealKind === 'landlord' ? 'Landlord listing created' : 'Lead created')
      onCreated?.()
      onOpenChange(false)
    } catch (err) {
      toast.error(friendlyDbError(err, 'Could not create the deal'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create deal</DialogTitle>
          <DialogDescription className="line-clamp-1">{row.title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label>Convert to</Label>
            <div className="flex gap-2">
              {(['lead', 'landlord'] as const).map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={dealKind === k ? 'default' : 'outline'}
                  onClick={() => setDealKind(k)}
                >
                  {k === 'lead' ? 'Lead' : 'Landlord deal'}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {dealKind === 'landlord'
                ? 'Creates a landlord-rep listing on this property (owner as landlord).'
                : 'Opens a standalone lead to follow up with tasks.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deal-address">Address</Label>
            <Input
              id="deal-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street address of the property"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label>Parcels (runs the county enhancer)</Label>
            {parcels.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={p.county} onValueChange={(v) => setParcel(i, { county: v, parcel: formatParcelId(p.parcel, v) })}>
                  <SelectTrigger className="w-40 shrink-0">
                    <SelectValue placeholder="County" />
                  </SelectTrigger>
                  <SelectContent>
                    {ENRICHABLE_COUNTIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={p.parcel}
                  onChange={(e) => setParcel(i, { parcel: e.target.value })}
                  onBlur={() => setParcel(i, { parcel: formatParcelId(p.parcel, p.county) })}
                  placeholder="Parcel ID — paste raw"
                  autoComplete="off"
                />
                {parcels.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remove parcel"
                    onClick={() => setParcels((prev) => prev.filter((_, idx) => idx !== i))}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setParcels((prev) => [...prev, { county: '', parcel: '' }])}
            >
              <Plus className="size-3.5" /> Add another parcel
            </Button>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label>Contact (optional)</Label>
              <Select value={type} onValueChange={(v) => setType(v as Enums<'contact_category'>)}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(contactCategoryLabels) as Enums<'contact_category'>[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {k === 'owning_entity' ? 'Owner (verified)' : contactCategoryLabels[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name" autoComplete="off" />
              <Input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name" autoComplete="off" />
            </div>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" autoComplete="off" />
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="off" />
            {type === 'owning_entity' && (
              <p className="text-[11px] leading-tight text-muted-foreground">
                An owner with a phone is saved as the property's <strong>verified owner</strong>.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? 'Creating…' : 'Create deal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
