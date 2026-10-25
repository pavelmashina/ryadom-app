import { date, fmt, iso, today } from "./domain";

/** Compact event-details label based on local calendar dates, not elapsed hours. */
export function formatEventDetailDate(
  on: string, time: string, referenceDate: string = today(),
): string {
  const reference = date(referenceDate);
  const tomorrow = iso(new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1));
  let label: string;
  if (on === referenceDate) {
    label = "Сегодня";
  } else if (on === tomorrow) {
    label = "Завтра";
  } else {
    const weekday = fmt(on, { weekday: "short" }).replace(/\.$/, "");
    label = weekday.charAt(0).toLocaleUpperCase("ru-RU") + weekday.slice(1)
      + ", " + fmt(on, { day: "numeric", month: "short" });
  }
  return time ? `${label}, ${time}` : label;
}
