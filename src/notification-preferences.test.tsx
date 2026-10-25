import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import NotificationPreferencesSettings from "./NotificationPreferencesSettings";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./push-api";
import type { AuthSession } from "./backend";

const source=(name:string)=>readFileSync(new URL(name, import.meta.url),"utf8");
const migration=source("../supabase/migrations/20261023190200_account_notification_preferences.sql");
const account=source("./Account.tsx");
const styles=source("./styles.css");
const css=source("./training.css");
const push=source("./PushSettings.tsx");
const api=source("./push-api.ts");
const ui=source("./NotificationPreferencesSettings.tsx");

describe("Account notification preferences and compact UI",()=>{
 it("provides independent persistent switches and per-pet category filters",()=>{
  const session={user:{id:"00000000-0000-4000-8000-000000000001"},accessToken:"fake"} as AuthSession;
  const html=renderToStaticMarkup(<NotificationPreferencesSettings session={session}/>);
  expect(html).toContain("О тренировках");
  expect(html).toContain("О событиях");
  expect(html).toContain("Напоминания");
  expect((html.match(/role="switch"/g)||[]).length).toBe(3);
  expect(ui).toContain("notification-pet-filter");
  expect(ui).toContain("Все питомцы");
  expect(ui).not.toContain("Напомнить о тренировке");
  expect(api).toContain("notification_preferences?on_conflict=user_id");
  expect(api).toContain("getValidSession()");
  expect(api).toContain('source: "personal"');
  expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
   trainings_enabled:false,events_enabled:true,reminders_enabled:true,training_offset_minutes:60,
   trainings_pet_ids:null,events_pet_ids:null,reminders_pet_ids:null,
  });
 });
 it("never grants anonymous access and checks auth.uid for all preference changes",()=>{
  expect(migration).toContain("alter table public.notification_preferences enable row level security");
  expect(migration).toContain("user_id=(select auth.uid())");
  expect(migration).toContain("grant select,insert,update on public.notification_preferences to authenticated");
  expect(migration).toContain("revoke all on public.notification_preferences from public,anon,authenticated");
  expect(migration).toContain("on conflict do nothing");
 });
 it("fans out enabled event reminders to active pet members respecting their type preferences",()=>{
  expect(migration).toContain("distinct on (rem.event_id)");
  expect(migration).toContain("member.user_id");
  expect(migration).toContain("member.status='active'");
  expect(migration).toContain("cfg.event_type='reminder'");
  expect(migration).toContain("coalesce(pref.reminders_enabled,true)");
  expect(migration).toContain("coalesce(pref.events_enabled,true)");
  expect(migration).toContain("from public.notification_deliveries d");
  expect(migration).toContain("for update of d skip locked");
 });
 it("builds account-wide training reminders without changing explicit personal reminders",()=>{
  expect(migration).toContain("source in ('personal','account')");
  expect(migration).toContain("pref.training_offset_minutes");
  expect(migration).toContain("r.source='account'");
  expect(migration).toContain("r.source='personal'");
  expect(migration).toContain("on conflict do nothing");
  expect(migration).toContain("public.claim_due_training_push");
 });
 it("removes the account avatar card and unnecessary notification introduction",()=>{
  expect(account).not.toContain("Ваш аккаунт");
  expect(account).not.toContain("Адрес для входа и восстановления доступа");
  expect(account).toContain('className="account-email-line"');
  expect(account).toContain('<NotificationPreferencesSettings session={session} disabled={!pushEnabled} pets={pets} />');
  expect(push).not.toContain("Напоминания о событиях питомца.");
  expect(styles).toContain(".account-content > .heading {");
  expect(styles).toContain(".account-section-shell {");
  expect(styles).toContain(".notification-toggle-row {");
  expect(styles).toContain(".notification-pet-filter summary {");
  expect(styles).toContain(".new-pet-form .form-actions {");
 });
 it("keeps compact monthly value and checkbox labels on the same typographic level",()=>{
  expect(css).toContain(".monthly-day-picker .monthly-last-day");
  expect(css).toContain("gap: 1px;");
  expect(css).toContain("font-size: var(--font-size-xs);");
  expect(css).toContain("flex: 0 1 164px;");
 });
});
