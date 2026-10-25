import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatEventDetailDate } from "./event-detail-date";
import { recurrenceText } from "./recurrence";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("./App.tsx");
const css = read("./styles.css");
const detail = app.split('case "detail": {')[1]?.split('case "pets":')[0] ?? "";

describe("Event / reminder detail presentation", () => {
  it("shows Today and Tomorrow with time, omitting the time when none is set", () => {
    expect(formatEventDetailDate("2026-10-25", "20:00", "2026-10-25")).toBe("Сегодня, 20:00");
    expect(formatEventDetailDate("2026-10-26", "08:30", "2026-10-25")).toBe("Завтра, 08:30");
    expect(formatEventDetailDate("2026-10-25", "", "2026-10-25")).toBe("Сегодня");
    expect(formatEventDetailDate("2026-10-26", "", "2026-10-25")).toBe("Завтра");
  });

  it("uses a weekday abbreviation and short day/month for other dates", () => {
    expect(formatEventDetailDate("2027-09-13", "", "2027-09-10")).toBe("Пн, 13 сент.");
    expect(formatEventDetailDate("2027-09-13", "20:00", "2027-09-10")).toBe("Пн, 13 сент., 20:00");
    expect(formatEventDetailDate("2027-09-14", "", "2027-09-10")).toBe("Вт, 14 сент.");
    expect(formatEventDetailDate("2026-10-24", "", "2026-10-25")).toBe("Сб, 24 окт.");
    expect(formatEventDetailDate("2027-01-01", "12:00", "2026-12-31")).toBe("Завтра, 12:00");
  });

  it("renders one clock-labelled line, category and repeat below; no planned or empty-note placeholders", () => {
    expect(detail).toContain('className="event-detail-datetime"');
    expect(detail).toContain('<Clock aria-hidden="true" />');
    expect(detail).toContain("formatEventDetailDate(overlay.on, e.time)");
    expect(detail).toContain('e.kind === "reminder" ? "Напоминание" : "Событие"');
    expect(detail).toContain("recurrenceText(e)");
    expect(detail).toContain('{e.note?.trim() && <p className="note">{e.note}</p>}');
    expect(detail).not.toContain("Заметка не добавлена");
    expect(detail).not.toContain('"Запланировано"');
    expect(detail.indexOf("formatEventDetailDate")).toBeLessThan(detail.indexOf("recurrenceText(e)"));
    expect(recurrenceText({
      date: "2026-10-25", repeat: "weekly",
      repeatInterval: 1, repeatWeekdays: [7], repeatEndType: "date", end: "2026-12-01",
    })).toContain("до 2026-12-01");
  });

  it("outlines the Delete action in the application's red without a fill", () => {
    expect(detail).toContain('variant="destructive" className="event-detail-delete"');
    const selector = ".event-detail-modal .event-detail-actions .event-detail-delete.btn,";
    const style = css.split(selector)[1]?.split("}")[0] ?? "";
    expect(style).toContain("border: 1px solid var(--color-danger)");
    expect(style).toContain("background: transparent");
    expect(style).toContain("color: var(--color-danger)");
    expect(style).toContain(".event-detail-delete.btn:hover");
  });

  it("aligns the date's clock icon with its text in the existing compact style", () => {
    const d = css.split(".event-detail-modal .event-detail-summary .event-detail-datetime {")[1]?.split("}")[0] ?? "";
    expect(d).toContain("display: flex");
    expect(d).toContain("align-items: center");
    expect(d).toContain("gap: var(--space-compact-2)");
    const icon = css.split(".event-detail-modal .event-detail-datetime svg {")[1]?.split("}")[0] ?? "";
    expect(icon).toContain("width: var(--icon-size-sm)");
    expect(icon).toContain("height: var(--icon-size-sm)");
  });
});
