import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { blankPet } from "./domain";
import Calendar from "./Calendar";
import EventForm from "./EventForm";
import ReminderSettings from "./ReminderSettings";
import type { AuthSession } from "./backend";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("./styles.css");
const sql = read("../supabase/migrations/20261025114433_shared_pet_event_reminders_and_category_delivery.sql");
const session: AuthSession = {
  user: { id: "member", email: "member@example.test" },
  accessToken: "test", refreshToken: "test", expiresAt: 9999999999999,
};

describe("Day calendar matches Training and notifications follow category permissions", () => {
  it("uses Training's top spacing and semibold size for both Day section titles", () => {
    expect(css).toContain(".app main:has(> .day-screen) { padding-top: var(--space-compact-3); }");
    for (const selector of [".day-screen > .heading h1 {", ".day-screen > .day-selected-title h2 {"]) {
      const block = css.split(selector)[1]?.split("}")[0] ?? "";
      expect(block).toContain("font-size: var(--font-size-lg);");
      expect(block).toContain("font-weight: var(--font-weight-semibold);");
    }
  });

  it("positions selected and current-day circles with markers exactly as Training", () => {
    const html = renderToStaticMarkup(<Calendar pet={blankPet("Мася")}
      selected="2026-10-25" month="2026-10-01"
      setSelected={() => {}} setMonth={() => {}}
      onAdd={() => {}} onTraining={() => {}} onToggle={() => {}} onDetail={() => {}} />);
    expect(html).toContain('class="day-screen"');
    expect(html).toContain('aria-current="date"');
    expect(html).toContain('class="day-date-number"');
    expect(html).toContain('class="dots"');
    const dayCircle = css.split(".day-screen .calendar .date.btn .day-date-number {").slice(-1)[0]?.split("}")[0] ?? "";
    expect(dayCircle).toContain("width: var(--day-circle-size);");
    expect(dayCircle).toContain("aspect-ratio: 1 / 1;");
    expect(dayCircle).toContain("border-radius: 50%;");
    expect(css).toContain("--day-circle-size: 36px;");
    expect(css).toContain("transform: translateY(1px);");
    expect(css).toContain("height: 8px;");
  });

  it("keeps the notification explanation in detail settings, not New Event", () => {
    const html = renderToStaticMarkup(<EventForm selected="2026-10-25" onSave={() => {}} />);
    expect(html).not.toContain("Напоминание сохраняется лично");
    expect(html).not.toContain("Уведомления получают");
    expect(html).not.toContain("Уведомления об окончании запасов");
    expect(html).toContain("Напомнить");
    const detail = renderToStaticMarkup(<ReminderSettings session={session} petId="pet" eventId="event" />);
    expect(detail).toContain("все участники питомца");
    expect(detail).toContain("предупреждения о запасах");
  });

  it("stores one effective shared event reminder without exposing anonymous writes", () => {
    const api = read("./push-api.ts");
    expect(api).toContain("rpc/get_shared_event_reminder");
    expect(api).toContain("rpc/set_shared_event_reminder");
    expect(api).not.toContain("event_reminders?id=eq.");
    expect(sql).toContain("member.user_id=auth.uid() and member.status='active'");
    expect(sql).toContain("member.user_id=actor and member.status='active'");
    expect(sql).toContain("revoke all on function public.set_shared_event_reminder(uuid,integer,boolean) from public,anon;");
    expect(sql).toContain("order by rem.updated_at desc,rem.id desc");
  });

  it("routes calendar categories and stock alerts through users' own enabled preferences", () => {
    expect(sql).toContain("cfg.event_type='reminder'");
    expect(sql).toContain("coalesce(pref.reminders_enabled,true)");
    expect(sql).toContain("coalesce(pref.events_enabled,true)");
    expect(sql).toContain("where cfg.enabled and");
    expect(sql).toContain("newest.updated_at desc");
    expect((sql.match(/coalesce\(pref.reminders_enabled,true\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("join public.pet_members member");
  });
});
