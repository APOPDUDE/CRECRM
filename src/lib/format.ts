import type { Enums } from '@/lib/database.types'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** $18,500,000 */
export function formatCurrency(value: number | null | undefined): string | null {
  if (value == null) return null
  return currencyFormatter.format(value)
}

/** $14.50 PSF */
export function formatPsf(value: number | null | undefined): string | null {
  if (value == null) return null
  return `$${value.toFixed(2)} PSF`
}

/** 125,000 SF */
export function formatSf(value: number | null | undefined): string | null {
  if (value == null) return null
  return `${value.toLocaleString('en-US')} SF`
}

/** 1.4 MB, 312 KB, 980 B */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Rate for a lease listing, price for a sale listing, both for a 'both' listing. */
export function formatListingPrice(deal: {
  deal_type: Enums<'deal_type'>
  asking_rate_psf: number | null
  asking_price: number | null
}): string | null {
  if (deal.deal_type === 'both') {
    return (
      [formatPsf(deal.asking_rate_psf), formatCurrency(deal.asking_price)]
        .filter(Boolean)
        .join(' · ') || null
    )
  }
  return deal.deal_type === 'sale' ? formatCurrency(deal.asking_price) : formatPsf(deal.asking_rate_psf)
}
