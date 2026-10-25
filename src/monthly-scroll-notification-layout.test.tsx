import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const recurrence = read("./RecurrenceFields.tsx");
const training = read("./training.css");
const notifications = read("./NotificationPreferencesSettings.tsx");
const styles = read("./styles.css");

describe("Month-day visual inset and nested training notifications", () => {
  it("draws a real 20px visual inset while keeping a tappable native picker", () => {
    expect(recurrence).toContain('className="monthly-day-control"');
    expect(recurrence).toContain('className="monthly-day-value"');
    expect(recurrence).toContain('<ChevronDown className="monthly-day-chevron"');
    expect(recurrence).toContain('<select id={monthlyDayId} aria-label="Число месяца"');
    const wrapper = training.split(".monthly-day-control {")[1]?.split("}")[0] ?? "";
    expect(wrapper).toContain("padding: 0 var(--space-compact-3) 0 var(--field-control-inline)");
    const picker = training.split(".monthly-day-picker .monthly-day-field .monthly-day-control select {")[1]?.split("}")[0] ?? "";
    expect(picker).toContain("position: absolute");
    expect(picker).toContain("inset: 0");
    expect(picker).toContain("opacity: 0");
    expect(training).toContain("flex: 0 1 164px;");
  });
  it("places a per-pet multi-select beneath every enabled notification category", () => {
    expect(notifications).toContain('className="notification-category"');
    expect(notifications).toContain('prefs[key]&&<details className="notification-pet-filter"');
    expect(notifications).toContain('key: "trainings_enabled"');
    expect(notifications).toContain('key: "events_enabled"');
    expect(notifications).toContain('key: "reminders_enabled"');
    expect(notifications).not.toContain('className="notification-training-offset"');
    expect(notifications).toContain('disabled={disabled||busy||loading}');
  });
  it("uses compact pet selector typography and touch-sized choices", () => {
    const group = styles.split(".account-section-shell:has(.push-settings) .notification-preferences {").at(-1)?.split("}")[0] ?? "";
    expect(group).toContain("gap: 0");
    const selector = styles.split(".notification-pet-filter summary {")[1]?.split("}")[0] ?? "";
    expect(selector).toContain("min-height:var(--button-height-sm)");
    expect(selector).toContain("font-size:var(--font-size-sm)");
    const choices = styles.split(".notification-pet-option {")[1]?.split("}")[0] ?? "";
    expect(choices).toContain("min-height:var(--button-height-sm)");
  });
  it("matches the training section heading gap of twelve points", () => {
    const account = styles.split(".account-content .account-section-shell {")[1]?.split("}")[0] ?? "";
    expect(account).toContain("gap: var(--space-compact-4)");
    expect(training).toContain("--training-heading-gap: var(--space-compact-4)");
  });
});
