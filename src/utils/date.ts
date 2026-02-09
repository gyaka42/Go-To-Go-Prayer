export function formatDateTime(isoOrDate: string | Date, locale?: string): string {
  const value = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return value.toLocaleString(locale);
}
