/** Export one chosen occurrence without connecting or modifying a personal calendar.
 * Dates/times in PET APP are local wall-clock values; no UTC conversion on export.
 */
export type CalendarExportItem = {
  id: string;
  title: string;
  on: string; // YYYY-MM-DD
  time: string; // HH:mm or empty for all-day
  description?: string;
  petName: string;
};

function clockRange(item: CalendarExportItem) {
  const [year, month, day] = item.on.split("-").map(Number);
  const [hour, minute] = item.time ? item.time.split(":").map(Number) : [0, 0];
  const start = new Date(year, month - 1, day, hour, minute);
  const end = new Date(start);
  if (item.time) end.setMinutes(end.getMinutes() + 60);
  else end.setDate(end.getDate() + 1); // exclusive all-day end
  return { start, end };
}
const dayStamp = (d: Date) =>
  String(d.getFullYear()).padStart(4, "0") +
  String(d.getMonth() + 1).padStart(2, "0") +
  String(d.getDate()).padStart(2, "0");
const timeStamp = (d: Date) =>
  dayStamp(d) + "T" + String(d.getHours()).padStart(2, "0") +
  String(d.getMinutes()).padStart(2, "0") + "00";
const label = (item: CalendarExportItem) =>
  [item.petName.trim(), item.description?.trim()].filter(Boolean).join("\n");

export function googleCalendarUrl(item: CalendarExportItem, timezone?: string) {
  const { start, end } = clockRange(item);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: item.title,
    dates: item.time ? `${timeStamp(start)}/${timeStamp(end)}`
      : `${dayStamp(start)}/${dayStamp(end)}`,
    details: label(item),
  });
  if (item.time && timezone) params.set("ctz", timezone);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
const escapeIcs = (s: string) => s.replace(/\\/g, "\\\\")
  .replace(/\r\n|\n|\r/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

// iCalendar line folding at 75 UTF-8 octets, including Cyrillic descriptions.
function foldIcs(line: string): string[] {
  const out: string[] = [];
  let part = "", bytes = 0;
  const encoder = new TextEncoder();
  for (const char of line) {
    const length = encoder.encode(char).length;
    if (bytes + length > 75) {
      out.push(part);
      part = " "; bytes = 1;
    }
    part += char; bytes += length;
  }
  out.push(part);
  return out;
}
export function appleCalendarIcs(item: CalendarExportItem, stamp = new Date()): string {
  const { start, end } = clockRange(item);
  const startLine = item.time
    ? `DTSTART:${timeStamp(start)}` : `DTSTART;VALUE=DATE:${dayStamp(start)}`;
  const endLine = item.time
    ? `DTEND:${timeStamp(end)}` : `DTEND;VALUE=DATE:${dayStamp(end)}`;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RYADOM//Pet App//RU",
    "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${escapeIcs(item.id + "-" + item.on)}@ryadom-app`,
    `DTSTAMP:${stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
    startLine, endLine,
    `SUMMARY:${escapeIcs(item.title)}`,
    `DESCRIPTION:${escapeIcs(label(item))}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.flatMap(foldIcs).join("\r\n") + "\r\n";
}

/** An .ics file can be opened or imported into Apple Calendar from Files. */
export function downloadAppleCalendar(item: CalendarExportItem): void {
  const file = new Blob([appleCalendarIcs(item)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ryadom-${item.on}-${item.id.replace(/[^a-z0-9_-]/gi,"").slice(0,30)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}
