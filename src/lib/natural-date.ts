// Pure date/time extraction, no model and no database involved.
//
// Date arithmetic is the one thing a small local model reliably gets wrong: it
// will confidently answer "Friday" with the wrong calendar date. Resolving it in
// code keeps the model's job to language understanding, where it is competent.

export type ParsedDate = {
  date: Date | null;
  hasTime: boolean;
  /** The substrings consumed, so the caller can strip them from a title. */
  matched: string[];
};

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

function atTime(date: Date, hours: number, minutes: number): Date {
  const copy = new Date(date);
  copy.setHours(hours, minutes, 0, 0);
  return copy;
}

function startOfDay(date: Date): Date {
  return atTime(date, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/**
 * Days forward to the next occurrence of a weekday. "Friday" said on a Friday
 * means a week away, not today — saying "Friday" about today would be odd.
 */
function daysUntilWeekday(from: Date, weekday: number): number {
  const delta = (weekday - from.getDay() + 7) % 7;
  return delta === 0 ? 7 : delta;
}

function extractTime(text: string): {
  hours: number;
  minutes: number;
  matched: string;
} | null {
  const noon = /\b(noon|midday)\b/i.exec(text);
  if (noon) return { hours: 12, minutes: 0, matched: noon[0] };

  const midnight = /\bmidnight\b/i.exec(text);
  if (midnight) return { hours: 0, minutes: 0, matched: midnight[0] };

  // 1pm, 1:30pm, 13:00, at 9
  const clock = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (!clock) return null;

  const hasMeridiem = Boolean(clock[3]);
  const hasMinutes = clock[2] !== undefined;
  const explicitAt = /^at\s/i.test(clock[0].trim());

  // A bare number is only a time when something marks it as one, otherwise
  // "buy 2 apples" would become 02:00.
  if (!hasMeridiem && !hasMinutes && !explicitAt) return null;

  let hours = Number(clock[1]);
  const minutes = clock[2] ? Number(clock[2]) : 0;
  if (hours > 23 || minutes > 59) return null;

  const meridiem = clock[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  return { hours, minutes, matched: clock[0] };
}

export function parseNaturalDate(text: string, now = new Date()): ParsedDate {
  const matched: string[] = [];
  let day: Date | null = null;

  const relative = /\b(today|tonight|tomorrow|yesterday)\b/i.exec(text);
  const inDays = /\bin\s+(\d{1,3})\s+(day|days|week|weeks)\b/i.exec(text);
  const nextWeek = /\bnext\s+week\b/i.exec(text);
  const weekday = new RegExp(
    `\\b(next\\s+|this\\s+)?(${WEEKDAYS.join("|")})\\b`,
    "i",
  ).exec(text);
  const dayMonth = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS.join("|")})\\b`,
    "i",
  ).exec(text);
  const monthDay = new RegExp(
    `\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "i",
  ).exec(text);
  const isoDate = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);

  if (isoDate) {
    day = startOfDay(
      new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])),
    );
    matched.push(isoDate[0]);
  } else if (relative) {
    const word = relative[1].toLowerCase();
    const offset =
      word === "tomorrow" ? 1 : word === "yesterday" ? -1 : 0;
    day = startOfDay(addDays(now, offset));
    matched.push(relative[0]);
  } else if (inDays) {
    const amount = Number(inDays[1]);
    const unit = inDays[2].toLowerCase().startsWith("week") ? 7 : 1;
    day = startOfDay(addDays(now, amount * unit));
    matched.push(inDays[0]);
  } else if (weekday) {
    const index = WEEKDAYS.indexOf(
      weekday[2].toLowerCase() as (typeof WEEKDAYS)[number],
    );
    const base = daysUntilWeekday(now, index);
    // "next friday" means the week after the coming one.
    const bump = /next/i.test(weekday[1] ?? "") ? 7 : 0;
    day = startOfDay(addDays(now, base + bump));
    matched.push(weekday[0]);
  } else if (nextWeek) {
    day = startOfDay(addDays(now, daysUntilWeekday(now, 1)));
    matched.push(nextWeek[0]);
  } else if (dayMonth || monthDay) {
    const source = dayMonth ?? monthDay!;
    const dayNumber = Number(dayMonth ? source[1] : source[2]);
    const monthName = (dayMonth ? source[2] : source[1]).toLowerCase();
    const month = MONTHS.indexOf(monthName as (typeof MONTHS)[number]);

    if (dayNumber >= 1 && dayNumber <= 31) {
      let candidate = new Date(now.getFullYear(), month, dayNumber);
      // A date already past this year means they mean next year.
      if (candidate < startOfDay(now)) {
        candidate = new Date(now.getFullYear() + 1, month, dayNumber);
      }
      day = startOfDay(candidate);
      matched.push(source[0]);
    }
  }

  // "tonight" implies an evening time unless one was given.
  const time = extractTime(text);
  const tonight = /\btonight\b/i.test(text);

  if (!day && !time) return { date: null, hasTime: false, matched };

  const base = day ?? startOfDay(now);

  if (time) {
    matched.push(time.matched);
    let resolved = atTime(base, time.hours, time.minutes);
    // A bare time that has already passed today means tomorrow.
    if (!day && resolved < now) resolved = addDays(resolved, 1);
    return { date: resolved, hasTime: true, matched };
  }

  if (tonight) return { date: atTime(base, 19, 0), hasTime: true, matched };

  return { date: base, hasTime: false, matched };
}

/** Removes the date/time phrases from a sentence, leaving the subject. */
export function stripMatches(text: string, matched: string[]): string {
  let result = text;
  for (const phrase of matched) {
    result = result.replace(phrase, " ");
  }
  return result
    .replace(/\s+/g, " ")
    .replace(/\s*[,;]\s*$/, "")
    .replace(/\b(on|at|by|due)\s*$/i, "")
    .trim();
}
