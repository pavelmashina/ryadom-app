// Test-only helper: a PGlite database with the Supabase objects our
// migrations rely on (auth, roles, cron, net, vault) stubbed out.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const migrationsDir = new URL("../supabase/migrations/", import.meta.url);

export const migrationFiles = () =>
  readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

export const migrationSql = (file: string) =>
  readFileSync(new URL(file, migrationsDir), "utf8")
    // PGlite has no pg_cron/pg_net; the stubs below provide their API.
    .replace(/create extension if not exists pg_(cron|net);/g, "");

const SUPABASE_STUBS = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key, email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated') $$;
grant usage on schema auth to authenticated, anon, service_role;
create table public.user_state(user_id uuid primary key references auth.users(id), state jsonb);
grant select on public.user_state to authenticated;
create schema cron;
create table cron.job(jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(name text, sched text, cmd text) returns bigint language sql as
  $$ insert into cron.job(jobname,schedule,command) values(name,sched,cmd)
     on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command
     returning jobid $$;
create function cron.unschedule(name text) returns boolean language sql as
  $$ with d as (delete from cron.job where jobname=name returning 1) select exists(select 1 from d) $$;
create schema net;
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}',
  params jsonb default '{}', timeout_milliseconds integer default 1000) returns bigint
  language sql as $$ select 1::bigint $$;
create schema vault;
create table vault.secrets(name text primary key, secret text);
create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
`;

export type TestDatabase = {
  db: PGlite;
  /** Act as an authenticated Supabase user (RLS applies). */
  asUser(uid: string): Promise<void>;
  /** Back to the superuser role (bypasses RLS) for setup/inspection. */
  asAdmin(): Promise<void>;
  addUser(uid: string, email?: string): Promise<void>;
  apply(file: string): Promise<void>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T>;
};

/**
 * Creates a database with stubs and applies migrations whose file name is
 * accepted by `include` (all by default), in file-name order.
 */
export async function createTestDatabase(
  include: (file: string) => boolean = () => true,
): Promise<TestDatabase> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const t: TestDatabase = {
    db,
    async asUser(uid) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
      await db.exec("set role authenticated");
    },
    async asAdmin() {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    },
    async addUser(uid, email = `${uid.slice(-4)}@example.test`) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [uid, email]);
    },
    async apply(file) {
      try {
        await db.exec(migrationSql(file));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    },
    async one(sql, params = []) {
      const result = await db.query<{ v: any }>(sql, params);
      return result.rows[0]?.v;
    },
  };
  for (const file of migrationFiles().filter(include)) await t.apply(file);
  return t;
}
