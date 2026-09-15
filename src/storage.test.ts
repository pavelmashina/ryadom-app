import { describe, it, expect, vi, afterEach } from "vitest";
import { loadState, saveState, parseBackup, STORAGE_KEY } from "./storage";
import { initialState } from "./domain";
afterEach(() => vi.unstubAllGlobals());
describe("Persistent data and recovery", () => {
  it("roundtrips all pet data", () => {
    const state = initialState();
    expect(parseBackup(JSON.stringify(state))).toEqual(state);
  });
  it("rejects corrupted/version-mismatched backups", () => {
    expect(() => parseBackup("{")).toThrow();
    expect(() => parseBackup('{"version":2,"pets":[]}')).toThrow();
  });
  it("preserves unreadable storage rather than overwriting it", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => "{broken", setItem });
    expect(loadState().error).not.toBe("");
    expect(setItem).not.toHaveBeenCalled();
  });
  it("surfaces quota errors so UI cannot falsely report saving", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    });
    expect(() => saveState(initialState())).toThrow("QuotaExceeded");
  });
  it("saves valid state under the versioned key", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    const state = initialState();
    saveState(state);
    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify(state));
  });
});
