import type { Pet, State } from "./domain";

export type PendingShopping = {
  petId: string;
  item: Pet["shopping"][number];
};

/** A server reply can arrive after more purchases were added. Merge by stable IDs. */
export function applyPendingShopping(state: State, pending: PendingShopping[]): State {
  if (!pending.length) return state;
  return {
    ...state,
    pets: state.pets.map((pet) => {
      const additions = pending
        .filter(({ petId, item }) => petId === pet.id && !pet.shopping.some((x) => x.id === item.id))
        .map(({ item }) => item);
      return additions.length ? { ...pet, shopping: [...pet.shopping, ...additions] } : pet;
    }),
  };
}

/** Keep unsynced drafts scoped to the signed-in account across PWA restarts. */
export function shoppingDraftKey(userId: string) {
  return "ryadom:pending-shopping:v1:" + userId;
}

export function readShoppingDrafts(userId: string): PendingShopping[] {
  try {
    const raw = localStorage.getItem(shoppingDraftKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PendingShopping => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as Partial<PendingShopping>;
      const item = value.item;
      return typeof value.petId === "string" &&
        typeof item?.id === "string" && item.id.length > 0 &&
        typeof item.name === "string" && item.name.length > 0 &&
        typeof item.quantity === "string" && item.done === false;
    }).slice(0, 100);
  } catch {
    return [];
  }
}

export function writeShoppingDrafts(userId: string, drafts: PendingShopping[]) {
  try {
    const key = shoppingDraftKey(userId);
    if (drafts.length) localStorage.setItem(key, JSON.stringify(drafts));
    else localStorage.removeItem(key);
  } catch {
    // Saving to the server still works in restricted/private browser contexts.
  }
}

export function unsyncedShoppingError(cause: unknown) {
  return "Покупка добавлена в список, но ещё не синхронизирована. " +
    (cause instanceof Error ? cause.message : "Проверьте соединение.");
}
