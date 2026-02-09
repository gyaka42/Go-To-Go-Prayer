export function formatDateTime(isoOrDate: string | Date): string {
  const value = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return value.toLocaleString();
}
