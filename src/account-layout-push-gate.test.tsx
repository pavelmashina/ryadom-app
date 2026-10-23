import { describe,expect,it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import NotificationPreferencesSettings from "./NotificationPreferencesSettings";
import type { AuthSession } from "./backend";

const src=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const recurrence=src("./RecurrenceFields.tsx");
const css=src("./training.css");
const styles=src("./styles.css");
const account=src("./Account.tsx");
const push=src("./PushSettings.tsx");
const preferences=src("./NotificationPreferencesSettings.tsx");
const session={user:{id:"00000000-0000-4000-8000-000000000002"},accessToken:"fake"} as AuthSession;

describe("Latest compact account and training refinements",()=>{
 it("uses shortened last-day text and aligns check and text with the 36px number selector",()=>{
  expect(recurrence).toContain('label="Последнее число"');
  expect(recurrence).not.toContain('label="Последнее число месяца"');
  expect(css).toContain(".monthly-day-picker .monthly-last-day {");
  expect(css).toContain("align-self: flex-end;");
  expect(css).toContain("height: 36px;");
  expect(css).toContain("align-items: center;");
  expect(css).toContain(".monthly-last-day .checkbox-hit {");
 });
 it("reduces the overall new-pet dialog height instead of just the gap above Save",()=>{
  expect(styles).toContain("dialog:has(.new-pet-form) .modal-content {");
  expect(styles).toContain("padding-bottom: var(--space-compact-1);");
  expect(styles).toContain(".new-pet-form .form-actions {");
  expect(styles).toContain("margin-top: 0;");
  expect(styles).toContain("padding: 0;");
 });
 it("places security and notification headings above cards and email beside Email",()=>{
  expect(account).toContain('<section className="account-section-shell">');
  expect(account).toContain('<SectionHeader title={title} />');
  expect(account).toContain('<Card className="account-section">{children}</Card>');
  expect(account).toContain('className="account-email-line"');
  expect(account).toContain('{user.email}');
  expect(styles).toContain(".account-content > .heading {");
  expect(styles).toContain("margin: 0;");
  expect(styles).toContain(".account-content .account-email-line .account-email {");
  expect(styles).toContain("font-size: var(--font-size-sm);");
 });
 it("replaces the permission button with a switch linked to device subscription",()=>{
  expect(push).toContain("Допуск уведомлений");
  expect(push).toContain('role="switch" aria-label="Допуск уведомлений"');
  expect(push).toContain("onEnabledChange?.(enabled)");
  expect(push).toContain("event.target.checked ? subscribe() : unsubscribe()");
  expect(push).not.toContain('>Включить уведомления</Button>');
  expect(push).not.toContain('>Выключить уведомления</Button>');
 });
 it("disables all other switches and timing fields when permission is off",()=>{
  const html=renderToStaticMarkup(<NotificationPreferencesSettings session={session} disabled/>);
  expect(html).toContain('aria-disabled="true"');
  expect((html.match(/role="switch"/g)||[]).length).toBe(3);
  expect((html.match(/disabled=""/g)||[]).length).toBeGreaterThanOrEqual(3);
  expect(preferences).toContain("disabled={disabled||busy||loading}");
  expect(preferences).toContain("if(busy||loading||disabled)return;");
  expect(account).toContain("onEnabledChange={setPushEnabled}");
  expect(account).toContain("disabled={!pushEnabled}");
 });
});
