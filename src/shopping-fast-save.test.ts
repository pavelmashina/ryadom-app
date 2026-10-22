import { afterEach, describe, expect, it, vi } from "vitest";
import { blankPet, type State } from "./domain";
import {
  applyPendingShopping, readShoppingDrafts, shoppingDraftKey,
  writeShoppingDrafts, unsyncedShoppingError, type PendingShopping,
} from "./shopping-fast-save";
import { readFileSync } from "node:fs";

const initial = (): State => {
  const pet = blankPet("Мася");
  pet.id = "pet-1";
  return { version: 1, selectedPet: pet.id, pets: [pet] };
};
const pending: PendingShopping = {
  petId: "pet-1", item: { id: "purchase-fixed-uuid", name: "Корм", quantity: "1 пачка", done: false },
};
const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("Instant purchase creation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows pending purchases immediately without mutating the cloud snapshot", () => {
    const stored = initial();
    const updated = applyPendingShopping(stored, [pending]);
    expect(updated.pets[0].shopping).toEqual([pending.item]);
    expect(stored.pets[0].shopping).toEqual([]);
    expect(updated.pets[0].id).toBe(stored.pets[0].id);
  });

  it("deduplicates by stable purchase ID after a response was lost", () => {
    const once = applyPendingShopping(initial(), [pending]);
    expect(applyPendingShopping(once, [pending]).pets[0].shopping).toHaveLength(1);
    expect(applyPendingShopping(initial(), [{ ...pending, petId: "other-pet" }]).pets[0].shopping).toHaveLength(0);
  });

  it("retains unsynced purchases through a reload and isolates them by account", () => {
    const memory = new Map<string,string>();
    vi.stubGlobal("localStorage", {
      setItem: (k: string, v: string) => memory.set(k,v),
      getItem: (k: string) => memory.get(k) ?? null,
      removeItem: (k: string) => memory.delete(k),
    });
    writeShoppingDrafts("user-A", [pending]);
    expect(readShoppingDrafts("user-A")).toEqual([pending]);
    expect(readShoppingDrafts("user-B")).toEqual([]);
    expect(memory.has(shoppingDraftKey("user-A"))).toBe(true);
    writeShoppingDrafts("user-A", []);
    expect(readShoppingDrafts("user-A")).toEqual([]);
  });

  it("renders the list and closes the modal before waiting for a cloud response", () => {
    expect(source).toContain("liveState.current = next;");
    expect(source).toContain("setState(next);");
    expect(source).toContain("close();");
    expect(source).toContain("void flushShopping();");
    expect(source).toContain("<Form onSave={addShoppingInstantly}>");
    const add = source.split("function addShoppingInstantly(data: FormData) {")[1]?.split("\n  useEffect(")[0] ?? "";
    expect(add.indexOf("setState(next)")).toBeLessThan(add.indexOf("void flushShopping()"));
    expect(add).not.toContain("await onPersist");
  });

  it("serializes cloud writes, retries transient failures and gives a truthful pending notice", () => {
    expect(source).toContain("if (shoppingSync.current) return shoppingSync.current");
    expect(source).toContain("const batch = shoppingPending.current.slice()");
    expect(source).toContain("const savedIds = new Set(batch.map");
    expect(source).toContain("attempt < 2");
    expect(source).toContain('window.addEventListener("online", retry)');
    expect(unsyncedShoppingError(new Error("Нет связи"))).toContain("ещё не синхронизирована");
  });
});
