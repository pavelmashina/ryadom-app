import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import EventForm from "./EventForm";
import { eventSchema } from "./domain";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("./App.tsx");
const form = read("./EventForm.tsx");
const recurrence = read("./RecurrenceFields.tsx");
const css = read("./styles.css");
const sample = {
  id: "existing-event", name: "Ветеринар", category: "health" as const,
  kind: "event" as const, date: "2026-10-01", time: "18:00", note: "",
  reminder: "0", end: "2026-12-31", repeat: "monthly" as const,
  repeatInterval: 2, repeatMonthday: 15,
  repeatEndType: "date" as const,
};

describe("Editing existing repeating events", () => {
  it("starts editing the entire series, while deletion still defaults to a single occurrence", () => {
    const open = app.split('function modifyEvent(e: PetEvent, on: string, action: "edit" | "delete") {')[1]?.split("setOverlay(")[0] ?? "";
    expect(open).toContain('e.repeat === "once" ? "all" : action === "edit" ? "all" : "single"');
    expect(app).toContain('const editSource: PetEvent = scope === "all"');
    expect(app).toContain('scope === "single"');
    expect(app).toContain('{ repeat: "once" as const, end: "", repeatEndType: undefined');
    expect(app).toContain('key={scope}');
  });

  it("restores the saved repeat frequency, interval, monthly day and end date", () => {
    const existing = eventSchema.parse(sample);
    const html = renderToStaticMarkup(
      <EventForm selected="2026-11-15" existing={existing} onSave={async () => {}} />,
    );
    expect(html).toContain('value="monthly" selected=""');
    expect(html).toContain('value="2"');
    expect(html).toContain('class="monthly-day-value"');
    expect(html).toContain('>15</span>');
    expect(html).toContain('value="date" selected=""');
    expect(html).toContain('value="2026-12-31"');
    expect(html).toContain("Свернуть настройки");
    expect(form).toContain('initiallyExpanded={!!existing && existing.repeat !== "once"}');
  });

  it("restores custom weekly days and an occurrence-count end setting", () => {
    const existing = eventSchema.parse({
      ...sample,
      repeat: "weekly", repeatWeekdays: [2, 5],
      repeatInterval: 3, repeatEndType: "count",
      repeatCount: 8, end: "",
    });
    const html = renderToStaticMarkup(
      <EventForm selected="2026-10-20" existing={existing} onSave={async () => {}} />,
    );
    expect(html).toContain('value="weekly" selected=""');
    expect(html).toContain('value="3"');
    expect(html).toContain('value="count" selected=""');
    expect(html).toContain('value="8"');
    expect(html).toContain("Свернуть настройки");
  });

  it("does not expand recurrence options on a new non-repeating event", () => {
    const html = renderToStaticMarkup(
      <EventForm selected="2026-10-25" onSave={async () => {}} />,
    );
    expect(html).toContain('value="once" selected=""');
    expect(html).not.toContain("Свернуть настройки");
    expect(recurrence).toContain("useState(initiallyExpanded)");
  });

  it("matches the Edit scope label and picker to Category and Type styles", () => {
    expect(app).toContain('className="event-modify-modal"');
    const layout = css.split(".event-modify-modal {")[1]?.split("}")[0] ?? "";
    const field = css.split(".event-modify-modal > .field {")[1]?.split("}")[0] ?? "";
    const label = css.split(".event-modify-modal > .field > label {")[1]?.split("}")[0] ?? "";
    const select = css.split(".event-modify-modal > .field select {")[1]?.split("}")[0] ?? "";
    expect(layout).toContain("gap: var(--space-compact-4)");
    expect(field).toContain("gap: var(--space-compact-2)");
    expect(field).toContain("margin: 0");
    expect(label).toContain("font-size: var(--font-size-md)");
    expect(label).toContain("font-weight: var(--font-weight-medium)");
    expect(select).toContain("min-height: var(--button-height-sm)");
    expect(select).toContain("font-size: var(--font-size-sm)");
    expect(select).toContain("font-weight: var(--font-weight-regular)");
    expect(select).toContain("padding: var(--space-compact-3) var(--field-control-inline)");
  });
});
