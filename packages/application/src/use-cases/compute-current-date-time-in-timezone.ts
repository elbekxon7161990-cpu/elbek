/**
 * TASK-BOT-001 — `ExtractionContext.currentDateTime` (TASK-AI-002, §4.5.3's
 * sample: `"2026-08-07T14:32:00+05:00"`) needs the current wall-clock time
 * *in the user's own timezone*, with an explicit UTC offset — never the
 * server's own timezone (§4.5's own instruction). `resolveUserLocalReferenceDate`
 * (TASK-FIN-001) solves a related but different problem (a calendar-date-only
 * value for BR-EXP-002's future-date check); this is the full timestamp
 * TASK-AI-002's prompt needs, which nothing built so far computes.
 *
 * Uses `Intl.DateTimeFormat`'s `timeZoneName: 'longOffset'` (Node/ECMA-402
 * built-in, no new dependency) to read both the wall-clock parts and the
 * correct offset for `timezone` at `now` — correctly varies for DST-observing
 * zones, unlike a hardcoded offset table would.
 */
export function computeCurrentDateTimeInTimezone(now: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(now);
    const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';

    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = get('hour') === '24' ? '00' : get('hour');
    const minute = get('minute');
    const second = get('second');
    const offsetRaw = get('timeZoneName'); // e.g. "GMT+05:00" or "GMT"
    const offset = offsetRaw === 'GMT' ? '+00:00' : offsetRaw.replace('GMT', '');

    if (!year || !month || !day || !offset) {
      return now.toISOString();
    }

    return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
  } catch {
    return now.toISOString();
  }
}
