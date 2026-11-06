// How a due date is written on a card or a row: the day and the short month, "14 Nov". One formatter, built once.
const DUE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export function dueLabel(date: Date): string {
  return DUE.format(date);
}
