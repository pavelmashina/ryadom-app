// Issue #2: normalized calendar as the source of truth.
// Runs the real migration chain in PGlite: legacy JSON calendar → tables,
// verifies nothing is lost, then checks access rules, overrides, series
// splits, IANA time zones (DST, 29 February) and client/server parity.
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createTestDatabase, type TestDatabase } from "./test-database";
import { blankPet, type Pet, type PetEvent } from "./domain";
import { occursOn } from "./recurrence";

const MIGRATION = "20261111120000_calendar_source_of_truth.sql";
const owner = "20000000-0000-4000-8000-000000000001",
  editor = "20000000-0000-4000-8000-000000000002",
  outsider = "20000000-0000-4000-8000-000000000003",
  revoked = "20000000-0000-4000-8000-000000000004";

let t: TestDatabase;
const pet = blankPet("Календарный питомец");
const command = crypto.randomUUID();
const ev = (fields: Partial<PetEvent> & { id?: string }): PetEvent => ({
  id: crypto.randomUUID(),
  name: "Событие",
  category: "care",
  date: "2026-10-05",
  time: "",
  repeat: "once",
  end: "",
  reminder: "0",
  note: "",
  ...fields,
});
// Legacy JSON exactly as clients stored it before the migration.
const once = ev({ name: "Прививка", category: "health", date: "2026-10-01", time: "10:30", note: "Взять паспорт" });
const weekly = ev({
  name: "Груминг", date: "2026-10-05", time: "18:00", repeat: "weekly",
  repeatInterval: 2, repeatWeekdays: [3, 1], repeatEndType: "count", repeatCount: 10,
  exceptions: [{ on: "2026-10-07", cancelled: true }, { on: "2026-10-19", newDate: "2026-10-20" }],
});
const monthlyLast = ev({ name: "Таблетка от клещей", date: "2026-01-31", repeat: "monthly", repeatMonthday: 32, repeatEndType: "date", end: "2026-12-31" });
const leapYearly = ev({ name: "День рождения", date: "2028-02-29", repeat: "yearly" });
const dailyReminder = ev({ name: "Корм", kind: "reminder", date: "2026-10-01", time: "08:00", repeat: "daily", end: "2026-10-10", reminder: "30", reminderEnabled: true, linkedRecord: "rec-1" });
// Oldest format: weekly without any of the extended recurrence fields.
const legacyWeekly = { id: crypto.randomUUID(), name: "Прогулка в парке", category: "training", date: "2026-10-06", time: "", repeat: "weekly", end: "", reminder: "0", note: "" };
const orphanDoneKey = `${crypto.randomUUID()}:2026-10-01`;
const legacyEvents = [once, weekly, monthlyLast, leapYearly, dailyReminder, legacyWeekly];
const legacyDone = {
  [`${once.id}:2026-10-01`]: true,
  [`${weekly.id}:2026-10-05`]: true,
  [`${weekly.id}:2026-10-20`]: true,
  [`${dailyReminder.id}:2026-10-03`]: true,
  [orphanDoneKey]: true,
};

async function load(): Promise<any> {
  return (await t.one("select public.load_shared_state() v")).state;
}
async function myPet(): Promise<Pet & { revision: number }> {
  return (await load()).pets.find((p: Pet) => p.id === pet.id);
}
async function save(p: any, revision: number | null, extra: Record<string, unknown> = {}) {
  const changes = [{ pet: { ...p, trainingVersion: 2 }, revision, ...extra }];
  return (await t.one("select public.save_shared_state($1::jsonb,'[]'::jsonb,$2) v", [JSON.stringify(changes), p.id])).state;
}
async function access(action: string, args: { code?: string; target?: string; subject?: string } = {}) {
  return t.one("select public.pet_access($1,$2,$3::uuid,$4::uuid) v",
    [action, args.code ?? null, args.target ?? null, args.subject ?? null]);
}
async function occurrences(from: string, to: string, pid = pet.id) {
  return (await t.db.query<any>(
    "select event_id, occurrence_on::text, on_day::text, title, time_of_day, comment, timezone, starts_at, done from public.calendar_occurrences($1,$2,$3)",
    [pid, from, to])).rows;
}
const days = (rows: any[], id: string) => rows.filter((r) => r.event_id === id).map((r) => r.on_day);
async function join(user: string) {
  await t.asUser(owner);
  const code = (await myPet()).shareCode!;
  await t.asUser(user);
  await access("request", { code });
  const requestId = (await access("outgoing"))[0].id;
  await t.asUser(owner);
  await access("approve", { subject: requestId });
}

let sessionsBefore: any[];
beforeAll(async () => {
  t = await createTestDatabase((f) => f < MIGRATION);
  for (const u of [owner, editor, outsider, revoked]) await t.addUser(u);
  // Pre-migration state: owner saves the legacy JSON calendar + training history.
  await t.asUser(owner);
  const legacy: any = {
    ...pet,
    events: legacyEvents,
    done: legacyDone,
    commands: [{ id: command, name: "Сидеть" }],
    workouts: [{
      id: crypto.randomUUID(), date: "2026-10-02", status: "completed", duration_minutes: 20,
      comment: "Отлично", results: [{ command_id: command, performance_score: 5, mode: "repeat", comment: "" }],
    }],
    trainingSchedules: [{
      id: crypto.randomUUID(), name: "Послушание", time_of_day: "19:00", repeat_type: "weekly",
      recurrence_frequency: "weekly", recurrence_interval: 2, recurrence_end_type: "never",
      weekdays: [2], starts_on: "2026-10-06", ends_on: null, is_active: true, comment: "", command_ids: [command],
    }],
  };
  await save(legacy, null);
  await join(editor);
  await join(revoked);
  await t.asUser(owner);
  await access("revoke", { target: pet.id, subject: revoked });
  await t.asAdmin();
  sessionsBefore = (await t.db.query(
    "select s.id, s.status, s.date::text, s.comment, r.performance_score from public.training_sessions s left join public.training_session_commands r on r.training_session_id=s.id where s.pet_id=$1 and s.status='completed' order by s.id",
    [pet.id])).rows;
  expect(sessionsBefore).toHaveLength(1);
  // The JSON calendar is where it has always been before the migration.
  expect(await t.one("select data->'events' v from public.pets where id=$1", [pet.id])).toHaveLength(6);
  await t.apply(MIGRATION);
}, 120000);
afterAll(async () => { await t.db.close(); });

describe("migration of the legacy JSON calendar", () => {
  it("keeps a full backup and removes the calendar from pets.data", async () => {
    await t.asAdmin();
    const backup = await t.one("select jsonb_build_object('events',events,'done',done) v from pet_private.calendar_legacy_backup where pet_id=$1", [pet.id]);
    expect(backup.events).toEqual(JSON.parse(JSON.stringify(legacyEvents)));
    expect(backup.done).toEqual(legacyDone);
    expect(await t.one("select (data ? 'events') or (data ? 'done') v from public.pets where id=$1", [pet.id])).toBe(false);
    expect(await t.one("select data->>'name' v from public.pets where id=$1", [pet.id])).toBe(pet.name);
  });

  it("loads every event, exception and completion without loss or duplicates", async () => {
    await t.asUser(owner);
    const p = await myPet();
    expect(p.events.map((e) => e.id)).toEqual(legacyEvents.map((e) => e.id));
    const byId = Object.fromEntries(p.events.map((e) => [e.id, e]));
    expect(byId[once.id]).toMatchObject({ name: "Прививка", category: "health", date: "2026-10-01", time: "10:30", note: "Взять паспорт", repeat: "once", end: "" });
    expect(byId[weekly.id]).toMatchObject({
      repeat: "weekly", repeatInterval: 2, repeatWeekdays: [1, 3], repeatEndType: "count", repeatCount: 10,
      exceptions: [{ on: "2026-10-07", cancelled: true }, { on: "2026-10-19", newDate: "2026-10-20" }],
    });
    expect(byId[monthlyLast.id]).toMatchObject({ repeat: "monthly", repeatMonthday: 32, repeatEndType: "date", end: "2026-12-31" });
    expect(byId[dailyReminder.id]).toMatchObject({ kind: "reminder", reminder: "30", reminderEnabled: true, linkedRecord: "rec-1", end: "2026-10-10" });
    expect(byId[legacyWeekly.id]).toMatchObject({ repeat: "weekly", repeatWeekdays: [2], repeatEndType: "never", end: "" });
    const { [orphanDoneKey]: _orphan, ...expectedDone } = legacyDone;
    expect(p.done).toEqual(expectedDone);
    await t.asAdmin();
    expect(await t.one("select count(*)::int v from public.calendar_events where pet_id=$1", [pet.id])).toBe(6);
    // One rule per repeating series, never per occurrence.
    expect(await t.one("select count(*)::int v from public.recurrence_rules where pet_id=$1 and source_type='event'", [pet.id])).toBe(5);
  });

  it("does not touch completed trainings and keeps training recurrence on the shared engine", async () => {
    await t.asAdmin();
    const after = (await t.db.query(
      "select s.id, s.status, s.date::text, s.comment, r.performance_score from public.training_sessions s left join public.training_session_commands r on r.training_session_id=s.id where s.pet_id=$1 and s.status='completed' order by s.id",
      [pet.id])).rows;
    expect(after).toEqual(sessionsBefore);
    const sc = await t.one("select id v from public.training_schedules where pet_id=$1", [pet.id]);
    expect(await t.one("select pet_private.recurrence_occurs($1,'2026-10-20') v", [sc])).toBe(true);
    expect(await t.one("select pet_private.recurrence_occurs($1,'2026-10-13') v", [sc])).toBe(false);
  });

  it("refuses to run twice on top of the new function versions", async () => {
    await t.asAdmin();
    await expect(t.apply(MIGRATION)).rejects.toThrow(/differs from the reviewed version/);
  });
});

describe("access: owner / editor / outsider / revoked member", () => {
  it("owner and active editor see the calendar; outsider and revoked do not", async () => {
    for (const [user, visible] of [[owner, 6], [editor, 6], [outsider, 0], [revoked, 0]] as const) {
      await t.asUser(user);
      expect(await t.one("select count(*)::int v from public.calendar_events")).toBe(visible);
      expect(await t.one("select count(*)::int v from public.recurrence_rules where source_type='event'")).toBe(visible ? 5 : 0);
      expect(await t.one("select count(*)::int v from public.calendar_event_exceptions")).toBe(visible ? 2 : 0);
      expect(await t.one("select count(*)::int v from public.calendar_event_completions")).toBe(visible ? 4 : 0);
      if (visible) expect((await occurrences("2026-10-01", "2026-10-31")).length).toBeGreaterThan(0);
      else await expect(occurrences("2026-10-01", "2026-10-31")).rejects.toThrow(/Нет доступа/);
    }
  });

  it("nobody writes calendar tables directly; revoked members cannot save", async () => {
    for (const user of [owner, editor, outsider]) {
      await t.asUser(user);
      await expect(t.db.query(
        "insert into public.calendar_events(id,pet_id,title,starts_on) values(gen_random_uuid(),$1,'x','2026-10-01')", [pet.id],
      )).rejects.toThrow(/permission denied/);
      await expect(t.db.query("update public.calendar_events set title='x'")).rejects.toThrow(/permission denied/);
      await expect(t.db.query("delete from public.calendar_event_completions")).rejects.toThrow(/permission denied/);
    }
    await t.asUser(owner);
    const p = await myPet();
    await t.asUser(revoked);
    await expect(save({ ...p, events: [] }, p.revision)).rejects.toThrow(/отозван|отсутствует/);
    await t.asUser(outsider);
    await expect(t.db.query("select pet_private.store_calendar($1,'[]','{}',$2)", [pet.id, outsider])).rejects.toThrow(/permission denied/);
    await t.asAdmin();
    expect(await t.one("select count(*)::int v from public.calendar_events where pet_id=$1", [pet.id])).toBe(6);
  });

  it("an editor's changes are stored and visible to the owner", async () => {
    await t.asUser(editor);
    const p = await myPet();
    const added = ev({ name: "От редактора", date: "2026-11-02" });
    await save({ ...p, events: [...p.events, added] }, p.revision);
    await t.asUser(owner);
    expect((await myPet()).events.at(-1)).toMatchObject({ id: added.id, name: "От редактора" });
    await t.asAdmin();
    expect(await t.one("select created_by v from public.calendar_events where id=$1", [added.id])).toBe(editor);
  });

  it("an event id belonging to another pet is rejected", async () => {
    await t.asUser(outsider);
    const other = { ...blankPet("Чужой"), events: [ev({ id: once.id })] };
    await expect(save(other, null)).rejects.toThrow(/другому питомцу/);
  });
});

describe("occurrences, overrides and series splits", () => {
  it("computes only the requested range with cancelled/moved occurrences", async () => {
    await t.asUser(owner);
    const rows = await occurrences("2026-10-01", "2026-10-31");
    // every 2 weeks Mon+Wed from 05.10: 05, (07 cancelled), 19 → moved to 20, 21
    expect(days(rows, weekly.id)).toEqual(["2026-10-05", "2026-10-20", "2026-10-21"]);
    expect(rows.find((r) => r.event_id === weekly.id && r.on_day === "2026-10-20")).toMatchObject({ occurrence_on: "2026-10-19", done: true });
    expect(days(rows, monthlyLast.id)).toEqual(["2026-10-31"]);
    expect(days(rows, dailyReminder.id)).toHaveLength(10);
    await expect(occurrences("2026-01-01", "2027-03-01")).rejects.toThrow(/400/);
  });

  it("stores «only this» as an override and keeps the series intact", async () => {
    await t.asUser(owner);
    const p = await myPet();
    const series = p.events.find((e) => e.id === dailyReminder.id)!;
    const edited = { ...series, exceptions: [{ on: "2026-10-04", newDate: "2026-10-05", name: "Корм (другой)", time: "21:15", note: "Новый корм" }] };
    await save({ ...p, events: p.events.map((e) => (e.id === series.id ? edited : e)) }, p.revision);
    const after = (await myPet()).events.find((e) => e.id === series.id)!;
    expect(after).toMatchObject({ name: "Корм", time: "08:00", exceptions: [{ on: "2026-10-04", newDate: "2026-10-05", name: "Корм (другой)", time: "21:15", note: "Новый корм" }] });
    const rows = (await occurrences("2026-10-04", "2026-10-05")).filter((r) => r.event_id === series.id);
    expect(rows).toEqual([
      expect.objectContaining({ occurrence_on: "2026-10-05", on_day: "2026-10-05", title: "Корм", time_of_day: "08:00" }),
      expect.objectContaining({ occurrence_on: "2026-10-04", on_day: "2026-10-05", title: "Корм (другой)", time_of_day: "21:15", comment: "Новый корм" }),
    ]);
    await t.asAdmin();
    expect(await t.one("select count(*)::int v from public.calendar_events where pet_id=$1", [pet.id])).toBe(7);
  });

  it("an older client without the timezone field keeps the stored zone", async () => {
    await t.asUser(owner);
    const p = await myPet();
    const zoned = p.events.map((e) => (e.id === once.id ? { ...e, timezone: "America/New_York" } : e));
    await save({ ...p, events: zoned }, p.revision);
    const q = await myPet();
    const withoutZone = q.events.map(({ timezone: _tz, ...e }: any) => e);
    await save({ ...q, events: withoutZone }, q.revision);
    expect((await myPet()).events.find((e) => e.id === once.id)!.timezone).toBe("America/New_York");
    const r = await myPet();
    await save({ ...r, events: r.events.map((e) => (e.id === once.id ? { ...e, timezone: "Mars/Olympus" } : e)) }, r.revision);
    expect((await myPet()).events.find((e) => e.id === once.id)!.timezone).toBe("Europe/Moscow");
  });

  it("skips calendar writes when the client marks the calendar unchanged", async () => {
    await t.asUser(owner);
    const p = await myPet();
    await save({ ...p, events: [], done: {} }, p.revision, { updateCalendar: false });
    expect((await myPet()).events).toHaveLength(p.events.length);
  });

  it("deleting a series removes its rule, exceptions and completions", async () => {
    await t.asUser(owner);
    const p = await myPet();
    await save({ ...p, events: p.events.filter((e) => e.id !== weekly.id) }, p.revision);
    await t.asAdmin();
    expect(await t.one("select count(*)::int v from public.recurrence_rules where id=$1", [weekly.id])).toBe(0);
    expect(await t.one("select count(*)::int v from public.calendar_event_exceptions where event_id=$1", [weekly.id])).toBe(0);
    expect(await t.one("select count(*)::int v from public.calendar_event_completions where event_id=$1", [weekly.id])).toBe(0);
  });
});

describe("IANA time zones, DST and 29 February", () => {
  let nyWeekly: PetEvent, berlinGap: PetEvent;
  beforeAll(async () => {
    await t.asUser(owner);
    const p = await myPet();
    nyWeekly = ev({ name: "Нью-Йорк", date: "2027-03-01", time: "09:00", repeat: "weekly", timezone: "America/New_York" } as any);
    berlinGap = ev({ name: "Берлин", date: "2027-03-27", time: "02:30", repeat: "daily", repeatEndType: "count", repeatCount: 3, timezone: "Europe/Berlin" } as any);
    await save({ ...p, events: [...p.events, nyWeekly, berlinGap] }, p.revision);
  });

  it("keeps the local wall-clock time across a DST change", async () => {
    const rows = (await occurrences("2027-03-01", "2027-03-31")).filter((r) => r.event_id === nyWeekly.id);
    expect(rows.map((r) => r.on_day)).toEqual(["2027-03-01", "2027-03-08", "2027-03-15", "2027-03-22", "2027-03-29"]);
    // 09:00 EST = 14:00Z before 14 March, 09:00 EDT = 13:00Z after.
    expect(rows.map((r) => new Date(r.starts_at).toISOString().slice(11, 16))).toEqual(["14:00", "14:00", "13:00", "13:00", "13:00"]);
  });

  it("resolves a non-existent local time (spring-forward gap) deterministically", async () => {
    const rows = (await occurrences("2027-03-27", "2027-03-31")).filter((r) => r.event_id === berlinGap.id);
    expect(rows.map((r) => r.on_day)).toEqual(["2027-03-27", "2027-03-28", "2027-03-29"]);
    expect(rows.map((r) => new Date(r.starts_at).toISOString())).toEqual([
      "2027-03-27T01:30:00.000Z", // CET
      "2027-03-28T01:30:00.000Z", // 02:30 does not exist; PostgreSQL reads it as 03:30 CEST
      "2027-03-29T00:30:00.000Z", // CEST
    ]);
  });

  it("a yearly 29 February series falls on 28 February in common years", async () => {
    const rows = await occurrences("2028-01-01", "2028-12-31");
    expect(days(rows, leapYearly.id)).toEqual(["2028-02-29"]);
    expect(days(await occurrences("2029-01-01", "2029-12-31"), leapYearly.id)).toEqual(["2029-02-28"]);
    expect(days(await occurrences("2032-01-01", "2032-12-31"), leapYearly.id)).toEqual(["2032-02-29"]);
  });
});

describe("push reminders follow the normalized calendar", () => {
  it("enqueues an overridden occurrence at its own time with its own title", async () => {
    // A daily series at 06:00 UTC whose occurrence today is moved to "now + 5 min".
    const at = new Date(Date.now() + 5 * 60000);
    const day = at.toISOString().slice(0, 10), hhmm = at.toISOString().slice(11, 16);
    const yesterday = new Date(at.getTime() - 86400000).toISOString().slice(0, 10);
    const series = ev({
      name: "Лекарство", date: yesterday, time: "06:00", repeat: "daily", timezone: "UTC",
      exceptions: [{ on: day, time: hhmm, name: "Лекарство (перенесено)" }],
    } as any);
    await t.asUser(owner);
    const p = await myPet();
    await save({ ...p, events: [...p.events, series] }, p.revision);
    await t.db.query("select public.set_shared_event_reminder($1,5,true)", [series.id]);
    await t.asAdmin();
    await t.db.query("delete from public.notification_deliveries");
    expect(await t.one("select public.enqueue_due_push() v")).toBe(2); // owner + editor
    const jobs = (await t.db.query<any>("select * from public.claim_due_push(10)")).rows;
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job.title).toBe("Лекарство (перенесено)");
      expect(new Date(job.occurrence_at).toISOString().slice(0, 16)).toBe(`${day}T${hhmm}`);
    }
    // The revoked member and the outsider get nothing.
    expect(jobs.map((j: any) => j.user_id).sort()).toEqual([owner, editor].sort());
  });
});

describe("client and server use the same recurrence rules", () => {
  it("matches the TypeScript engine for generated series", async () => {
    let seed = 20261111;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    const freqs = ["daily", "weekly", "monthly", "yearly"] as const;
    const series: PetEvent[] = Array.from({ length: 40 }, (_, i) => {
      const repeat = freqs[i % 4];
      const start = `2026-${String(1 + rnd(12)).padStart(2, "0")}-${String(1 + rnd(28)).padStart(2, "0")}`;
      const endType = (["never", "date", "count"] as const)[rnd(3)];
      return ev({
        name: `Серия ${i}`, date: start, repeat,
        repeatInterval: 1 + rnd(3),
        repeatWeekdays: repeat === "weekly" ? [...new Set([1 + rnd(7), 1 + rnd(7)])] : undefined,
        repeatMonthday: repeat === "monthly" ? 1 + rnd(32) : undefined,
        repeatEndType: endType,
        end: endType === "date" ? "2027-06-30" : "",
        repeatCount: endType === "count" ? 1 + rnd(20) : undefined,
        exceptions: [{ on: start, cancelled: true }],
      });
    });
    await t.asUser(owner);
    const p = await myPet();
    await save({ ...p, events: [...p.events, ...series] }, p.revision);
    const from = "2026-01-01", to = "2027-01-31";
    const rows = await occurrences(from, to);
    const all: string[] = [];
    for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1))
      all.push(d.toISOString().slice(0, 10));
    for (const s of series)
      expect([...new Set(days(rows, s.id))], s.name).toEqual(all.filter((day) => occursOn(s, day)));
  });
});
