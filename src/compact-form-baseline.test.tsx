import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const trainingCss=read("./training.css");
const styles=read("./styles.css");
const account=read("./Account.tsx");
const tokens=read("./tokens.css");
const stock=read("./stock.css");
const recurrence=read("./RecurrenceFields.tsx");

describe("Shared form spacing and compact notification layout",()=>{
  it("sets a 20px text inset and widens the month-day picker",()=>{
    const selector=trainingCss.split(".monthly-day-control {").at(-1)!.split("}")[0];
    expect(selector).toContain("padding: 0 var(--space-compact-3) 0 var(--field-control-inline)");
    expect(trainingCss).toContain(".monthly-day-value {");
    const layout=trainingCss.split(".monthly-day-picker .monthly-day-field {").at(-1)!.split("}")[0];
    expect(layout).toContain("flex: 0 1 164px");
    expect(layout).toContain("width: 164px");
    expect(recurrence).toContain('label="Число месяца"');
  });
  it("uses the 12px manual-deduction bottom inset as a common token",()=>{
    expect(tokens).toContain("--form-action-bottom-inset: var(--space-compact-4)");
    const stockRule=stock.split(".stock-form {")[1]!.split("}")[0];
    expect(stockRule).toContain("padding-bottom: var(--form-action-bottom-inset)");
    const modalRule=styles.split("dialog:has(.new-pet-form) .modal-content {").at(-1)!.split("}")[0];
    expect(modalRule).toContain("padding-bottom: var(--form-action-bottom-inset)");
    expect(styles).toContain(".new-pet-form .form-actions {");
  });
  it("hides the redundant Account title and password hint",()=>{
    expect(account).not.toContain('<PageHeader title="Аккаунт" />');
    expect(account).not.toContain("Защитите доступ к вашим данным");
    expect(account).toContain('<AccountSection title="Вход и безопасность">');
  });
  it("puts a separator after the main permission switch and raises option labels to 16px",()=>{
    const separator=styles.split(".account-section-shell:has(.push-settings) .notification-preferences {")[1]!.split("}")[0];
    expect(separator).toContain("border-top: 1px solid var(--color-border)");
    expect(separator).toContain("padding-top: var(--space-compact-4)");
    const labels=styles.split(".account-section-shell:has(.push-settings) .notification-toggle-row,")[1]!.split("}")[0];
    expect(labels).toContain("font-size: var(--font-size-md)");
    expect(tokens).toContain("--font-size-md: 16px");
    expect(account).toContain('<NotificationPreferencesSettings session={session} disabled={!pushEnabled} pets={pets} />');
  });
});
