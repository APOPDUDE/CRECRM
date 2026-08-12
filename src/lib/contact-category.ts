import type { Enums } from '@/lib/database.types'

/**
 * Deliberately the same six words as `companyTypeLabels`. A person and the company they hang
 * off should not speak different languages — "vendor" has to mean vendor on both sides, or a
 * filter stops meaning one thing.
 */
export const contactCategoryLabels: Record<Enums<'contact_category'>, string> = {
  landlord: 'Landlord',
  owning_entity: 'Owning entity',
  tenant: 'Tenant',
  broker: 'Broker',
  vendor: 'Vendor',
  other: 'Other',
}

export const contactCategoryBadgeClasses: Record<Enums<'contact_category'>, string> = {
  landlord: 'bg-blue-50 text-blue-700 border-blue-200',
  owning_entity: 'bg-sky-50 text-sky-700 border-sky-200',
  tenant: 'bg-green-50 text-green-700 border-green-200',
  broker: 'bg-purple-50 text-purple-700 border-purple-200',
  vendor: 'bg-amber-50 text-amber-700 border-amber-200',
  other: 'bg-gray-50 text-gray-600 border-gray-200',
}

/** Sentinel for the select — Radix cannot hold `null` as an item value. */
export const NO_CATEGORY = '__none__'
