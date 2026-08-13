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

/** $605K, $1.23M, $12.3M — for headline figures that must read at a glance. */
export function compactUsd(value: number | null | undefined): string | null {
  if (value == null) return null
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`
  return `$${Math.round(value)}`
}

/**
 * Group an IN-PROGRESS numeric string with thousands commas — 1000 reads as 1,000
 * while you are still typing it. Keeps a trailing decimal point and partial decimals
 * so "12." and "12.5" survive the keystroke they are typed in.
 */
export function groupDigits(raw: string | number | null | undefined): string {
  let s = String(raw ?? '').replace(/,/g, '').replace(/[^0-9.\-]/g, '')
  const neg = s.startsWith('-')
  s = s.replace(/-/g, '')
  const dot = s.indexOf('.')
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
  let [intPart = '', decPart] = s.split('.')
  intPart = intPart.replace(/^0+(?=\d)/, '')
  let out = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (s.includes('.')) out += '.' + (decPart ?? '')
  return (neg ? '-' : '') + out
}

/** Drop the display commas so the value can be parsed as a number. */
export function ungroupDigits(raw: string): string {
  return raw.replace(/,/g, '')
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

/**
 * Parse a form text field into a number for a DB write: blank -> null, else Number(v).
 * Strips thousands commas first — money fields display grouped, and Number("1,500")
 * is NaN, which would otherwise write silently-wrong values.
 */
export function numOrNull(v: string): number | null {
  const t = ungroupDigits(v).trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
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
