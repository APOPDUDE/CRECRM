export function friendlyDbError(error: unknown, fallback: string): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : null
  if (code === '23503') {
    return 'This record is referenced by other records and cannot be deleted'
  }
  if (code === '23514') {
    return 'The values entered violate a data rule — check the form and try again'
  }
  return fallback
}
