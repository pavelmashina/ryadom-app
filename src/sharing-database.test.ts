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
      [JSON.stringify([{ pet: p, revision }]), p.id],
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
    "training_command_results",
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
