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

/**
 * Digits-only 10-digit US phone (drops a leading country-code 1), or null.
 * Mirrors the SQL normalize_phone() so the UI dedupes the same way the DB does.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = raw.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return d.slice(1)
  if (d.length === 10) return d
  return null
}

/** Canonical phone display: 941-806-8432 for a valid US number, else unchanged. */
export function formatPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const n = normalizePhone(raw)
  if (n) return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`
  return raw
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
