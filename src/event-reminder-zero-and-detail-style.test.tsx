import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import EventForm from "./EventForm";
import ReminderSettings from "./ReminderSettings";
import { reminderChoice, reminderOffsetMinutes, savedReminderChoice } from "./reminder-choice";
import { eventSchema, blankPet } from "./domain";
import type { AuthSession } from "./backend";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const session = {
  user: { id: "u", email: "user@example.test" },
  accessToken: "test", refreshToken: "test", expiresAt: 999999999999,
} as AuthSession;

describe("Immediate event reminder and compact detail", () => {
  it("accepts the immediate zero-minute preset from New Event all the way to persistence", () => {
    const html = renderToStaticMarkup(<EventForm selected="2026-10-25" onSave={async () => {}} />);
    expect(html).toContain('<option value="0">В момент события</option>');
    expect(html).not.toContain('<option value="now">');
    expect(reminderOffsetMinutes("0", 1, "minutes")).toBe(0);
    expect(reminderChoice(0, true).mode).toBe("0");
    expect(savedReminderChoice([{id:"a",event_id:"b",user_id:"u",offset_value:0,offset_unit:"minutes",enabled:true}]).mode).toBe("0");
    const valid = eventSchema.safeParse({
      id:"new",name:"Приём у ветеринара",category:"health",kind:"event",
      date:"2026-10-25",time:"12:00",repeat:"once",end:"",
      reminder:"0",reminderEnabled:true,note:"",
    });
    expect(valid.success).toBe(true);
    expect(read("./push-api.ts")).toContain("minutes < 0");
  });

  it("uses the same immediate preset in existing event reminder settings", () => {
    const html = renderToStaticMarkup(
      <ReminderSettings session={session} petId={blankPet("Пёс").id} eventId="example" />,
    );
    expect(html).toContain('<option value="0">В момент события</option>');
    expect(html).not.toContain("Уведомление получат");
    expect(html).toContain("Настройки напоминания");
    expect(html).not.toContain(">Напомнить</label>");
    expect(html).not.toContain(">Настройка напоминания</h3>");
    expect(html).toContain("Сохранить напоминание");
  });

  it("keeps the detail content but removes every recipient explanation", () => {
    const source = read("./App.tsx");
    const detail = source.split('case "detail": {')[1]?.split('case "pets":')[0] ?? "";
    expect(detail).toContain('className="event-detail-modal"');
    expect(detail).toContain('className="event-detail-summary"');
    expect(detail).not.toContain("<ReminderSettings");
    expect(detail).toContain('className="fields event-detail-actions"');
    expect(detail).toContain('<TrainingDateField');
    expect(detail).toContain("Отметить выполненным");
    expect(detail).not.toContain("Уведомление получат все");
    expect(read("./ReminderSettings.tsx")).not.toContain("Уведомление получат все");
  });

  it("uses the same typography and spacing tokens in the detail, reminder form and date picker", () => {
    const css = read("./styles.css");
    const head = css.split('dialog:has(.event-detail-modal) .modal-head h2 {')[1]?.split("}")[0] ?? "";
    expect(head).toContain("font-size: var(--font-size-lg)");
    expect(head).toContain("font-weight: var(--font-weight-medium)");
    const layout = css.split(".event-detail-modal {")[1]?.split("}")[0] ?? "";
    expect(layout).toContain("gap: var(--space-compact-4)");
    const reminder = css.split(".event-detail-modal .personal-reminder {")[1]?.split("}")[0] ?? "";
    expect(reminder).toContain("gap: var(--space-compact-4)");
    const actions = css.split(".event-detail-modal .fields.event-detail-actions {")[1]?.split("}")[0] ?? "";
    expect(actions).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    const field = css.split(".event-detail-modal .field > label {")[1]?.split("}")[0] ?? "";
    expect(field).toContain("font-size: var(--font-size-md)");
    expect(css).toContain('.event-detail-modal .training-date-wrap input[type="date"]');
    const value = css.split('.event-detail-modal .field :is(select, input:not([type="date"]), textarea) {')[1]?.split("}")[0] ?? "";
    expect(value).toContain("font-size: var(--font-size-sm)");
    expect(value).toContain("font-weight: var(--font-weight-regular)");
    expect(value).toContain("min-height: var(--button-height-sm)");
    expect(value).toContain("padding: var(--space-compact-3) var(--field-control-inline)");
  });
});
