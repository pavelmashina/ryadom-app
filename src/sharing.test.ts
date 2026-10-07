import { it, expect } from "vitest";
import { blankPet, type State } from "./domain";
import { sharedChanges } from "./cloud-data";
it("sends only changed pets with their original revision, never the whole account", () => {
  const a = { ...blankPet("A"), revision: 2 },
    b = { ...blankPet("B"), revision: 8 };
  const before: State = { version: 1, selectedPet: a.id, pets: [a, b] };
  const result = sharedChanges(
    { ...before, pets: [{ ...a, name: "New" }, b] },
    before,
  );
  expect(result.changes).toHaveLength(1);
  expect(result.changes[0].revision).toBe(2);
  expect(result.changes[0].pet.id).toBe(a.id);
  expect(result.removed).toEqual([]);
});
it("pet selection and server metadata changes never rewrite pet content", () => {
  const a = { ...blankPet("A"), revision: 2 };
  const before: State = { version: 1, selectedPet: a.id, pets: [a] };
  expect(
    sharedChanges({ ...before, pets: [{ ...a, pendingRequests: 3 }] }, before)
      .changes,
  ).toEqual([]);
});
