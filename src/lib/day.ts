/**
 * The local calendar day containing `day`: midnight to the next midnight. `to`
 * is exclusive and is the start of tomorrow, which also makes it the one place
 * "tomorrow" is worked out. Both dates are new, so a caller may set the time on
 * either. Next-day is added as a calendar day, not 24 hours, so a clock change
 * does not move it.
 */
export function dayBounds(day: Date): { from: Date; to: Date } {
  const from = new Date(day);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}
