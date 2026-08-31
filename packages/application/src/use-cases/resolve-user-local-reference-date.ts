/**
 * BR-EXP-002 — "not in the future" is defined relative to the user's own
 * timezone (`User.timezone`, an IANA zone name such as "Asia/Tashkent"),
 * not server UTC. Uses `Intl.DateTimeFormat` — a JS/Node platform built-in
 * available with zero new dependencies — to read which calendar date
 * `instant` falls on within that timezone, then re-expresses it as a
 * UTC-midnight `Date`: the same calendar-date-only representation
 * `Transaction`'s domain validation already compares `transactionDate`
 * against (§13.4 `DATE`, no time-of-day component).
 *
 * Falls back to `instant` itself (its own UTC calendar date — the prior,
 * still-safe behavior) if `timezone` is missing, empty, or not a valid IANA
 * zone name. A timezone lookup failure must never throw and must never
 * block transaction creation.
 */
export function resolveUserLocalReferenceDate(instant: Date, timezone: string): Date {
  if (!timezone) {
    return instant;
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(instant);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);

    if (!year || !month || !day) {
      return instant;
    }

    return new Date(Date.UTC(year, month - 1, day));
  } catch {
    return instant;
  }
}
