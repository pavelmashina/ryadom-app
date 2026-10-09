import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { blankPet } from "./domain";
const db = new PGlite();
const owner = "10000000-0000-4000-8000-000000000001",
  editor = "10000000-0000-4000-8000-000000000002",
  third = "10000000-0000-4000-8000-000000000003";
const pet = blankPet("Общий питомец"),
  command = crypto.randomUUID();
pet.commands = [{ id: command, name: "Рядом" }];
pet.weights = [{ id: crypto.randomUUID(), date: "2026-10-07", value: 7.3 }];
const sql = (file: string) =>
  readFileSync(
    new URL("../supabase/migrations/" + file, import.meta.url),
    "utf8",
  );
async function asUser(uid: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await db.exec("set role authenticated");
}
async function access(
  action: string,
  args: { code?: string; target?: string; subject?: string } = {},
) {
  return (
    await db.query<{ v: any }>(
      "select public.pet_access($1,$2,$3::uuid,$4::uuid) v",
      [action, args.code ?? null, args.target ?? null, args.subject ?? null],
    )
  ).rows[0].v;
}
async function load() {
  return (await db.query<{ v: any }>("select public.load_shared_state() v"))
    .rows[0].v.state;
}
async function save(p: any, revision: number | null) {
  return (
    await db.query<{ v: any }>(
      "select public.save_shared_state($1::jsonb,'[]'::jsonb,$2) v",
      [JSON.stringify([{ pet: { ...p, trainingVersion: 2 }, revision }]), p.id],
    )
  ).rows[0].v.state;
}
let shareCode: string, requestId: string;
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; create table public.user_state(user_id uuid primary key references auth.users(id),state jsonb); grant select on public.user_state to authenticated;`,
  );
  await db.query(
    "insert into auth.users values($1,'owner@example.test'),($2,'editor@example.test'),($3,'third@example.test')",
    [owner, editor, third],
  );
  for (const f of readdirSync(
    new URL("../supabase/migrations/", import.meta.url),
  )
    .filter((f) => f.startsWith("20261006"))
    .sort())
    await db.exec(sql(f));
  await asUser(owner);
  await db.query("select public.save_app_state($1::jsonb,0)", [
    JSON.stringify({ version: 1, selectedPet: pet.id, pets: [pet] }),
  ]);
  await db.exec("reset role");
  await db.exec(sql("20261007154510_pet_sharing.sql"));
  await db.exec(sql("20261008092135_training_diary_provenance.sql"));
  await db.exec(sql("20261009140053_command_archiving.sql"));
  await db.exec(sql("20261009172634_training_planning.sql"));
  await db.exec(sql("20261009172634_training_planning.sql"));
}, 30000);
afterAll(async () => {
  await db.close();
});
it("snapshot tag matches the lightweight polling tag", async () => {
  await asUser(owner);
  const result = (
    await db.query<{ v: any }>("select public.load_shared_state() v")
  ).rows[0].v;
  expect(result.tag).toBe(
    (await db.query<{ v: string }>("select public.shared_state_tag() v"))
      .rows[0].v,
  );
});
it("migrates the same pet and preserves data, owner membership and UUID", async () => {
  await asUser(owner);
  const state = await load();
  expect(state.pets).toHaveLength(1);
  expect(state.pets[0].id).toBe(pet.id);
  expect(state.pets[0].weights).toEqual(pet.weights);
  expect(state.pets[0].role).toBe("owner");
  shareCode = state.pets[0].shareCode;
  expect(shareCode).toMatch(/^RYD-[2-9A-H]{10}$/);
});
it("code lookup exposes only name/status and pending requests grant no data", async () => {
  await asUser(editor);
  expect(await access("lookup", { code: shareCode.toLowerCase() })).toEqual({
    name: pet.name,
    status: "available",
  });
  await access("request", { code: shareCode });
  await access("request", { code: shareCode });
  const out = await access("outgoing");
  expect(out).toHaveLength(1);
  requestId = out[0].id;
  expect((await load()).pets).toHaveLength(0);
  expect((await db.query("select * from public.pets")).rows).toHaveLength(0);
  await expect(save(pet, 1)).rejects.toThrow(/отозван|отсутствует/);
});
it("only owner can approve and editor receives the same entity", async () => {
  await expect(access("approve", { subject: requestId })).rejects.toThrow(
    /владельцу/,
  );
  await asUser(owner);
  expect((await access("manage", { target: pet.id })).requests[0].email).toBe(
    "editor@example.test",
  );
  await access("approve", { subject: requestId });
  await asUser(editor);
  const p = (await load()).pets[0];
  expect(p.id).toBe(pet.id);
  expect(p.role).toBe("editor");
  expect(p.weights).toEqual(pet.weights);
});
it("editor training and owner health edits are visible across accounts", async () => {
  await asUser(editor);
  let p = (await load()).pets[0];
  p.workouts = [
    {
      id: crypto.randomUUID(),
      date: "2026-10-07",
      duration_minutes: 15,
      comment: "Общая тренировка",
      results: [
        {
          command_id: command,
          performance_score: 4,
          mode: "repeat",
          comment: "",
        },
      ],
    },
  ];
  await save(p, p.revision);
  await asUser(owner);
  p = (await load()).pets[0];
  expect(p.workouts[0].comment).toBe("Общая тренировка");
  p.records = [
    {
      id: crypto.randomUUID(),
      date: "2026-10-07",
      name: "Осмотр",
      type: "Визит",
      note: "Тест",
    },
  ];
  await save(p, p.revision);
  await asUser(editor);
  expect((await load()).pets[0].records[0].name).toBe("Осмотр");
  expect(
    (
      await db.query("select * from public.training_sessions where pet_id=$1", [
        pet.id,
      ])
    ).rows,
  ).toHaveLength(1);
});
it("stale revisions fail atomically and do not overwrite another member", async () => {
  await asUser(editor);
  const stale = (await load()).pets[0];
  await asUser(owner);
  await save({ ...stale, name: "Обновлённое имя" }, stale.revision);
  await asUser(editor);
  await expect(
    save({ ...stale, name: "Устаревшее имя" }, stale.revision),
  ).rejects.toThrow(/другим участником/);
  expect((await load()).pets[0].name).toBe("Обновлённое имя");
});
it("direct role escalation and membership inserts are blocked", async () => {
  await asUser(editor);
  await expect(
    db.query("update public.pet_members set role='owner' where user_id=$1", [
      editor,
    ]),
  ).rejects.toThrow(/permission denied/);
  await expect(
    db.query(
      "insert into public.pet_members(pet_id,user_id,role) values($1,$2,'editor')",
      [pet.id, third],
    ),
  ).rejects.toThrow(/permission denied/);
  for (const action of ["rotate", "delete", "revoke", "manage"])
    await expect(
      access(action, { target: pet.id, subject: owner }),
    ).rejects.toThrow(/владельцу/);
  await expect(
    db.query("select public.save_shared_state('[]',$1::jsonb,'')", [
      JSON.stringify([{ id: pet.id, revision: 4 }]),
    ]),
  ).rejects.toThrow(/владелец/);
});
it("code rotation preserves membership, invalidates old code, and owner cannot revoke self", async () => {
  await asUser(owner);
  await expect(
    access("revoke", { target: pet.id, subject: owner }),
  ).rejects.toThrow(/владельца/);
  await access("rotate", { target: pet.id });
  const next = (await load()).pets[0].shareCode;
  expect(next).not.toBe(shareCode);
  await asUser(third);
  expect((await access("lookup", { code: shareCode })).error).toBeTruthy();
  shareCode = next;
  await asUser(editor);
  expect((await load()).pets).toHaveLength(1);
});
it("revocation blocks reads and writes including known pet and training IDs", async () => {
  await asUser(editor);
  const stale = (await load()).pets[0];
  await asUser(owner);
  await access("revoke", { target: pet.id, subject: editor });
  await asUser(editor);
  expect((await load()).pets).toHaveLength(0);
  for (const table of [
    "pets",
    "commands",
    "training_sessions",
    "training_session_commands",
  ])
    expect((await db.query("select * from public." + table)).rows).toHaveLength(
      0,
    );
  await expect(save(stale, stale.revision)).rejects.toThrow(
    /отозван|отсутствует/,
  );
});
it("reject, retry, cancel, reapprove and leave preserve the owner data", async () => {
  await asUser(editor);
  await access("request", { code: shareCode });
  let out = await access("outgoing");
  let pending = out.find((r: any) => r.status === "pending");
  await asUser(owner);
  await access("reject", { subject: pending.id });
  await asUser(editor);
  expect(
    (await access("outgoing")).find((r: any) => r.id === pending.id).status,
  ).toBe("rejected");
  await access("request", { code: shareCode });
  pending = (await access("outgoing")).find((r: any) => r.status === "pending");
  await access("cancel", { subject: pending.id });
  await access("request", { code: shareCode });
  pending = (await access("outgoing")).find((r: any) => r.status === "pending");
  await asUser(owner);
  await access("approve", { subject: pending.id });
  await asUser(editor);
  await access("leave", { target: pet.id });
  expect((await load()).pets).toHaveLength(0);
  await asUser(owner);
  expect((await load()).pets[0].records).toHaveLength(1);
});
it("new pet creation grants owner automatically and anon cannot access APIs", async () => {
  await asUser(third);
  const fresh = blankPet("Новый");
  const state = await save(fresh, null);
  expect(state.pets[0].role).toBe("owner");
  expect(state.pets[0].shareCode).toBeTruthy();
  await db.exec("reset role; set role anon");
  await expect(load()).rejects.toThrow(/permission denied/);
  await expect(access("lookup", { code: shareCode })).rejects.toThrow(
    /permission denied/,
  );
});
it("rate limits repeated code guessing without exposing pet data", async () => {
  await asUser(third);
  let result: any;
  for (let i = 0; i < 22; i++)
    result = await access("lookup", { code: "RYD-NOT-A-CODE" });
  expect(result).toEqual({ error: "Слишком много попыток. Подождите минуту." });
});
it("an owner deletion hides the pet while retaining recoverable records", async () => {
  await asUser(owner);
  await access("delete", { target: pet.id });
  expect((await load()).pets).toHaveLength(0);
  await db.exec("reset role");
  const rows = (
    await db.query<{ deleted_at: string }>(
      "select deleted_at from public.pets where id=$1",
      [pet.id],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].deleted_at).toBeTruthy();
  expect(
    (
      await db.query(
        "select * from public.pet_members where pet_id=$1 and role='owner' and status='active'",
        [pet.id],
      )
    ).rows,
  ).toHaveLength(1);
});

it("keeps immutable diary through saves and restricts it to active members", async () => {
  const importedPet = blankPet("Дневник тестового питомца");
  await asUser(owner);
  await save(importedPet, null);
  await db.exec("reset role");
  await db.query(
    "insert into public.training_diary(pet_id,source_key,source_hash,date,status,original_text,details) values($1,'fixture:row:1',repeat('a',64),'2025-01-01','skipped','Пропуск: исходный текст',$2::jsonb)",
    [
      importedPet.id,
      JSON.stringify({ commandNotes: { Рядом: "Знал до начала дневника" } }),
    ],
  );
  await asUser(owner);
  let state = await load();
  let stored = state.pets.find((p: any) => p.id === importedPet.id);
  expect(stored.trainingDiary[0].original_text).toBe("Пропуск: исходный текст");
  stored.trainingDiary[0].original_text = "Подмена из клиента";
  await save(stored, stored.revision);
  expect(
    (await load()).pets.find((p: any) => p.id === importedPet.id)
      .trainingDiary[0].original_text,
  ).toBe("Пропуск: исходный текст");
  await expect(
    db.query("update public.training_diary set original_text='Подмена'"),
  ).rejects.toThrow(/permission denied/);
  await asUser(third);
  expect(
    (await db.query("select * from public.training_diary")).rows,
  ).toHaveLength(0);
  await db.exec("reset role");
  await db.query(
    "insert into public.pet_members(pet_id,user_id,role) values($1,$2,'editor')",
    [importedPet.id, editor],
  );
  await asUser(editor);
  expect(
    (await db.query("select * from public.training_diary")).rows,
  ).toHaveLength(1);
  await db.exec("reset role");
  await db.query(
    "update public.pet_members set status='revoked' where pet_id=$1 and user_id=$2",
    [importedPet.id, editor],
  );
  await asUser(editor);
  expect(
    (await db.query("select * from public.training_diary")).rows,
  ).toHaveLength(0);
  await db.exec("reset role; set role anon");
  await expect(db.query("select * from public.training_diary")).rejects.toThrow(
    /permission denied/,
  );
  await db.exec("reset role");
});

it("archives commands for editors without losing history and rejects revoked edits", async () => {
  const fixture = blankPet("Архив команд");
  const used = crypto.randomUUID(),
    unused = crypto.randomUUID(),
    sid = crypto.randomUUID();
  fixture.commands = [
    { id: used, name: "Сохранить историю" },
    { id: unused, name: "Без занятий" },
  ];
  fixture.workouts = [
    {
      id: sid,
      date: "2026-01-01",
      duration_minutes: null,
      comment: "История",
      created_at: "2026-01-01T12:00:00Z",
      updated_at: "2026-01-01T12:00:00Z",
      results: [
        {
          command_id: used,
          performance_score: 4,
          mode: "repeat",
          comment: "Оценка",
        },
      ],
    },
  ];
  await asUser(owner);
  await save(fixture, null);
  await db.exec("reset role");
  await db.query(
    "insert into public.pet_members(pet_id,user_id,role) values($1,$2,'editor')",
    [fixture.id, editor],
  );
  await db.query(
    "insert into public.training_diary(pet_id,source_key,source_hash,date,status,original_text,session_id) values($1,'archive-test',repeat('a',64),'2026-01-01','conducted','Оригинал',$2)",
    [fixture.id, sid],
  );
  await asUser(editor);
  let current = (await load()).pets.find((p: any) => p.id === fixture.id);
  const history = JSON.stringify(current.workouts),
    diary = JSON.stringify(current.trainingDiary);
  current.commands = current.commands.map((c: any) => ({
    ...c,
    archived: true,
  }));
  await save(current, current.revision);
  current = (await load()).pets.find((p: any) => p.id === fixture.id);
  expect(current.commands.every((c: any) => c.archived)).toBe(true);
  expect(JSON.stringify(current.workouts)).toBe(history);
  expect(JSON.stringify(current.trainingDiary)).toBe(diary);
  // A stale client that does not know the archive property must not restore it.
  current.commands = current.commands.map(({ archived, ...c }: any) => c);
  await save(current, current.revision);
  current = (await load()).pets.find((p: any) => p.id === fixture.id);
  expect(current.commands.every((c: any) => c.archived)).toBe(true);
  // Even an omitted command cannot cascade-delete its historical score.
  current.commands = [];
  await save(current, current.revision);
  current = (await load()).pets.find((p: any) => p.id === fixture.id);
  expect(current.commands).toHaveLength(2);
  expect(JSON.stringify(current.workouts)).toBe(history);
  current.workouts[0].comment = "Отредактировано";
  await save(current, current.revision);
  current = (await load()).pets.find((p: any) => p.id === fixture.id);
  expect(current.workouts[0].results[0]).toMatchObject({
    command_id: used,
    performance_score: 4,
    comment: "Оценка",
  });
  expect(JSON.stringify(current.trainingDiary)).toBe(diary);
  await db.exec("reset role");
  await db.query(
    "update pet_members set status='revoked' where pet_id=$1 and user_id=$2",
    [fixture.id, editor],
  );
  await asUser(editor);
  current.commands[0].archived = false;
  await expect(save(current, current.revision)).rejects.toThrow(
    /отозван|отсутствует/,
  );
  await db.exec("reset role");
});

it("plans, completes the same session and materializes recurring schedules without duplicates", async () => {
  await asUser(owner);
  let p: any = blankPet("График");
  const cid = crypto.randomUUID();
  p.commands = [{ id: cid, name: "Ждать" }];
  const date = (await db.query<{ d: string }>("select current_date::text d"))
    .rows[0].d;
  const sid = crypto.randomUUID();
  p.workouts = [
    {
      id: sid,
      date,
      status: "planned",
      scheduled_at: date + "T16:00:00Z",
      completed_at: null,
      time: "19:00",
      name: "Вечер",
      duration_minutes: null,
      comment: "План",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      results: [
        {
          command_id: cid,
          performance_score: null,
          mode: "repeat",
          comment: "",
        },
      ],
    },
  ];
  p = (await save(p, null)).pets.find((x: any) => x.id === p.id);
  expect(p.workouts[0].id).toBe(sid);
  expect(p.workouts[0].status).toBe("planned");
  p.workouts[0] = {
    ...p.workouts[0],
    status: "completed",
    completed_at: date + "T16:35:00Z",
    duration_minutes: 35,
    results: [
      {
        command_id: cid,
        performance_score: 4,
        mode: "repeat",
        comment: "Получилось",
      },
    ],
  };
  p = (await save(p, p.revision)).pets.find((x: any) => x.id === p.id);
  expect(p.workouts).toHaveLength(1);
  expect(p.workouts[0].id).toBe(sid);
  const schedule = crypto.randomUUID();
  p.trainingSchedules = [
    {
      id: schedule,
      name: "График",
      repeat_type: "daily",
      weekdays: [],
      starts_on: date,
      ends_on: null,
      time_of_day: "19:00",
      is_active: true,
      command_ids: [cid],
      comment: "Повтор",
    },
  ];
  p = (await save(p, p.revision)).pets.find((x: any) => x.id === p.id);
  const count = p.workouts.length;
  expect(count).toBeGreaterThan(60);
  expect(count).toBeLessThan(94);
  const ids = p.workouts.map((w: any) => w.id).sort();
  let again = (await load()).pets.find((x: any) => x.id === p.id);
  expect(again.workouts.map((w: any) => w.id).sort()).toEqual(ids);
  let generated = again.workouts.find((w: any) => w.status === "planned");
  const movedId = generated.id;
  generated.scheduled_at = generated.date + "T17:30:00Z";
  generated.time = "20:30";
  again = (await save(again, again.revision)).pets.find(
    (x: any) => x.id === p.id,
  );
  expect(again.workouts.map((w: any) => w.id).sort()).toEqual(ids);
  generated = again.workouts.find((w: any) => w.id === movedId);
  expect(new Date(generated.scheduled_at).toISOString()).toContain("17:30");

  generated.status = "completed";
  generated.completed_at = generated.scheduled_at;
  generated.results[0].performance_score = 5;
  p = (await save(again, again.revision)).pets.find((x: any) => x.id === p.id);
  const completed = p.workouts.filter((w: any) => w.status === "completed");
  p.trainingSchedules[0].repeat_type = "weekdays";
  p.trainingSchedules[0].weekdays = [2, 4];
  p = (await save(p, p.revision)).pets.find((x: any) => x.id === p.id);
  expect(p.workouts.filter((w: any) => w.status === "completed")).toEqual(
    completed,
  );
  expect(
    p.workouts
      .filter((w: any) => w.status === "planned")
      .every((w: any) =>
        [2, 4].includes(new Date(w.date + "T12:00:00Z").getUTCDay()),
      ),
  ).toBe(true);
  p.trainingSchedules[0].is_active = false;
  p = (await save(p, p.revision)).pets.find((x: any) => x.id === p.id);
  expect(p.workouts.filter((w: any) => w.status === "planned")).toHaveLength(0);
  await asUser(third);
  expect(
    (
      await db.query("select * from public.training_schedules where id=$1", [
        schedule,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        "select * from public.training_session_commands where training_session_id=$1",
        [sid],
      )
    ).rows,
  ).toHaveLength(0);
  await expect(save(p, p.revision)).rejects.toThrow(/отозван|отсутствует/);
});
it("rejects null scores for completed sessions and commands belonging to another pet", async () => {
  await asUser(owner);
  let p: any = blankPet("Проверка");
  const cid = crypto.randomUUID();
  p.commands = [{ id: cid, name: "Сидеть" }];
  p = (await save(p, null)).pets.find((x: any) => x.id === p.id);
  p.workouts = [
    {
      id: crypto.randomUUID(),
      date: "2026-10-09",
      status: "completed",
      completed_at: "2026-10-09T09:00:00Z",
      duration_minutes: 10,
      comment: "",
      results: [
        {
          command_id: cid,
          performance_score: null,
          mode: "repeat",
          comment: "",
        },
      ],
    },
  ];
  await expect(save(p, p.revision)).rejects.toThrow(/Оцените/);
  p.workouts[0].results[0].performance_score = 4;
  p.workouts[0].results[0].command_id = command;
  await expect(save(p, p.revision)).rejects.toThrow(/другого питомца/);
});
