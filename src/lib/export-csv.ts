/**
 * CSV export for skip-trace hand-off.
 *
 * The export is the first leg of the verification loop:
 *   map selection -> CSV -> Terrakotta skip trace -> VA calls -> GHL -> back into the CRM.
 * PARCEL ID IS THE JOIN KEY and must survive every leg — matching the return trip on address
 * alone is what produced a 6% hit rate on the original Terrakotta import.
 */

/** RFC-4180 quoting: wrap in quotes and double any embedded quote. */
function cell(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(',')]
  for (const r of rows) lines.push(r.map(cell).join(','))
  // BOM so Excel opens UTF-8 addresses without mangling them
  return '﻿' + lines.join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // revoke on the next tick — Safari cancels the download if the URL dies too early
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** yyyy-mm-dd, for filenames. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
