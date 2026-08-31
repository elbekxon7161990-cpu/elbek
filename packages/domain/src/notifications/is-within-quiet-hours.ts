/**
 * TASK-BOT-009 (FR-NOT-003) — "quiet hours" setting, default 22:00-08:00
 * user-local time. Deliberately a small, standalone pure function (mirrors
 * `Transaction.isFutureDate`'s own "no User.timezone access at this layer"
 * shape) rather than reusing `computeCurrentDateTimeInTimezone`
 * (`@afa/application`), which returns a full formatted string this function
 * would then have to re-parse — `Intl.DateTimeFormat`'s `hour` part alone is
 * all quiet-hours checking actually needs.
 *
 * `startHour > endHour` is the normal case (22 > 8) — the window wraps past
 * midnight; handled explicitly rather than assuming callers always pass a
 * non-wrapping range.
 */
export function isWithinQuietHours(
  now: Date,
  timezone: string,
  startHour = 22,
  endHour = 8,
): boolean {
  const localHour = getLocalHour(now, timezone);
  if (startHour === endHour) {
    return false; // a zero-width window is never "within" (defensive, not expected in practice)
  }
  if (startHour > endHour) {
    return localHour >= startHour || localHour < endHour;
  }
  return localHour >= startHour && localHour < endHour;
}

function getLocalHour(now: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  });
  const hourPart = formatter.formatToParts(now).find((part) => part.type === 'hour')?.value;
  // `Intl`'s 24-hour format can render midnight as "24" depending on ICU
  // version/locale data — normalized to 0 so callers never see an
  // out-of-range hour value.
  const parsed = Number(hourPart);
  return parsed === 24 ? 0 : parsed;
}

/**
 * FR-NOT-003 — computes the next quiet-hours window END in UTC, for
 * scheduling a delayed delivery ("queues until the window's end" — §10.6.6).
 * `now` is assumed to already be within quiet hours (callers check
 * `isWithinQuietHours` first) — this function does not itself re-verify
 * that, only computes where the window ends from here.
 */
export function computeQuietHoursWindowEnd(now: Date, timezone: string, endHour = 8): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const localHour = get('hour') === 24 ? 0 : get('hour');

  // The window end is "today at endHour" if we're past midnight but before
  // endHour (e.g. 03:00, window ends 08:00 today); otherwise it's "tomorrow
  // at endHour" (e.g. 23:00, window ends 08:00 the next day).
  const daysToAdd = localHour < endHour ? 0 : 1;

  // `fakeUtcOfNow` reads `now`'s own local wall-clock digits as if they were
  // UTC — the gap between that and the real `now` instant is exactly this
  // timezone's current UTC offset (`fakeUtcOfNow = realNow + offset`, so
  // `offset = fakeUtcOfNow - realNow`). Applying that same offset to the
  // target wall-clock time (also read "as if UTC") converts it to the real
  // UTC instant: `realTarget = fakeUtcOfTarget - offset`. Good enough for a
  // same-day scheduling target — DST transitions mid-window are a rare edge
  // case this function does not attempt to model precisely.
  const fakeUtcOfNow = Date.UTC(get('year'), get('month') - 1, get('day'), localHour, 0, 0, 0);
  const offsetMs = fakeUtcOfNow - now.getTime();
  const fakeUtcOfTarget = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day') + daysToAdd,
    endHour,
    0,
    0,
    0,
  );
  return new Date(fakeUtcOfTarget - offsetMs);
}
