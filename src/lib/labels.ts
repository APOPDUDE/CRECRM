// Display labels for the enums the UI shows everywhere. Kept out of the component files
// so a dialog can be edited with Fast Refresh (a file that exports both components and
// constants reloads the whole tree instead).
import type { Enums } from '@/lib/database.types'

export const propertyKindLabels: Record<Enums<'property_kind'>, string> = {
  industrial: 'Industrial',
  office: 'Office',
  retail: 'Retail',
  land: 'Land',
  other: 'Other',
}

/** Property types offered for tenant requirements (a focused subset). */
export const tenantPropertyTypeOptions: Enums<'property_kind'>[] = [
  'office',
  'retail',
  'industrial',
  'land',
]

export const companyTypeLabels: Record<Enums<'company_type'>, string> = {
  landlord: 'Landlord',
  owning_entity: 'Owning entity',
  tenant: 'Tenant',
  broker: 'Broker',
  vendor: 'Vendor',
  other: 'Other',
}

type LeadSource = Enums<'lead_source'>

// Source colors are consistent app-wide (boards, match cards, detail panels).
export const leadSourceConfig: Record<LeadSource, { label: string; className: string }> = {
  loopnet: { label: 'LoopNet', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  sign_call: { label: 'Sign call', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  cold_call: { label: 'Cold call', className: 'bg-slate-50 text-slate-600 border-slate-200' },
  in_person: { label: 'In person', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  email: { label: 'Email', className: 'bg-violet-50 text-violet-700 border-violet-200' },
  text: { label: 'Text', className: 'bg-teal-50 text-teal-700 border-teal-200' },
  website: { label: 'Website', className: 'bg-green-50 text-green-700 border-green-200' },
  referral: { label: 'Referral', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  broker: { label: 'Broker', className: 'bg-orange-50 text-orange-700 border-orange-200' },
}

export const leadSourceLabels = Object.fromEntries(
  Object.entries(leadSourceConfig).map(([k, v]) => [k, v.label]),
) as Record<LeadSource, string>
