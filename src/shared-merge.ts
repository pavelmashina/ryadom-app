import { stateSchema, type State } from "./domain";

/** A concurrent edit cannot be merged without silently discarding someone's work. */
export class SharedEditConflict extends Error {
  constructor(readonly field: string) {
    super(
      "Этот же элемент изменён другим участником (" + field +
      "). Ваши данные не отправлены, чтобы не перезаписать его изменения. " +
      "Скопируйте текущий ввод, обновите данные и повторите действие.",
    );
    this.name = "SharedEditConflict";
  }
}

const keyedArrays: Record<string, string> = {
  pets: "id",
  events: "id",
  commands: "id",
  sessions: "id",
  workouts: "id",
  trainingSchedules: "id",
  trainingDiary: "source_key",
  weights: "id",
  records: "id",
  shopping: "id",
  documents: "id",
  results: "command_id",
};

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function identity(value: unknown, key: string, path: string): string {
  if (!record(value) || typeof value[key] !== "string" || !value[key])
    throw new SharedEditConflict(path);
  return value[key];
}
function index(items: unknown[], field: string, path: string) {
  const map = new Map<string, unknown>();
  for (const item of items) {
    const key = identity(item, field, path);
    if (map.has(key)) throw new SharedEditConflict(path);
    map.set(key, item);
  }
  return map;
}
function mergeArray(
  before: unknown[] | undefined, local: unknown[], remote: unknown[], path: string,
): unknown[] {
  const name = path.split(".").at(-1) ?? "";
  const field = keyedArrays[name];
  if (!field) throw new SharedEditConflict(path);
  const b = index(before ?? [], field, path);
  const l = index(local, field, path);
  const r = index(remote, field, path);
  const order = [...r.keys(), ...l.keys()].filter(
    (key, position, all) => all.indexOf(key) === position,
  );
  const result: unknown[] = [];
  for (const key of order) {
    const merged = mergeValue(b.get(key), l.get(key), r.get(key), path + "[" + key + "]");
    if (merged !== undefined) result.push(merged);
  }
  return result;
}

function mergeValue(base: unknown, local: unknown, remote: unknown, path: string): unknown {
  if (same(local, base)) return remote;
  if (same(remote, base) || same(local, remote)) return local;
  // Two sides created the same key differently, or one deleted an edited key.
  if (Array.isArray(local) && Array.isArray(remote) &&
      (Array.isArray(base) || base === undefined))
    return mergeArray(base as unknown[] | undefined, local, remote, path);
  if (base === undefined || local === undefined || remote === undefined)
    throw new SharedEditConflict(path);
  if (record(base) && record(local) && record(remote)) {
    const output: [string, unknown][] = [];
    for (const field of new Set([...Object.keys(base), ...Object.keys(remote), ...Object.keys(local)])) {
      const value = mergeValue(base[field], local[field], remote[field], path + "." + field);
      if (value !== undefined) output.push([field, value]);
    }
    return Object.fromEntries(output);
  }
  throw new SharedEditConflict(path);
}

/**
 * Three-way merge between the UI snapshot, the user's pending edit, and a fresh
 * server snapshot. Unrelated fields and records are preserved on both sides.
 * Concurrent changes to the same field are rejected, never silently replaced.
 *
 * Caller must save the result with fresh revisions and at most one retry.
 */
export function mergeSharedState(before: State, local: State, remote: State): State {
  let merged: unknown;
  try {
    merged = mergeValue(before, local, remote, "state");
  } catch (cause) {
    if (cause instanceof SharedEditConflict) throw cause;
    throw new SharedEditConflict("данные питомца");
  }
  const value = merged as State;
  // Current user's pet selection is local UI state; do not change the active
  // pet merely because the same account was open on a second device.
  if (value.pets.some((pet) => pet.id === local.selectedPet))
    value.selectedPet = local.selectedPet;
  const validated = stateSchema.safeParse(value);
  if (!validated.success) throw new SharedEditConflict("связанные записи");
  return validated.data;
}
