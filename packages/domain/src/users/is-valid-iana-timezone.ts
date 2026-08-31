/**
 * FR-PROF-003/§7.3.7 — "`timezone` must be a valid IANA timezone
 * identifier." `Intl.DateTimeFormat` throws `RangeError` for an unknown
 * zone and never throws for a real one — the standard, dependency-free way
 * to validate an IANA identifier without bundling/maintaining a static
 * zone-name list of our own.
 */
export function isValidIanaTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
