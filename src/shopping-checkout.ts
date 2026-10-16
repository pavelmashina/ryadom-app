import type { Pet } from "./domain";

/** A stock change is explicit: checking an item alone must never guess kilograms. */
export function completeShoppingItem(pet: Pet, itemId: string, addedKg: number, onDate: string): Pet {
  const item = pet.shopping.find((s) => s.id === itemId);
  if (!item) throw new Error("Покупка не найдена.");
  if (item.done) throw new Error("Покупка уже отмечена. Повторное пополнение запрещено.");
  if (!Number.isFinite(addedKg) || addedKg < 0 || addedKg > 100 ||
      Math.abs(Math.round(addedKg * 1000) - addedKg * 1000) > 0.0000001) {
    throw new Error("Укажите количество корма от 0 до 100 кг с точностью до грамма.");
  }
  if ((item.stockCreditedKg ?? 0) > 0 && addedKg > 0)
    throw new Error("Корм по этой покупке уже внесён в запас. Создайте новую покупку для следующего пополнения.");
  const stock = Math.round((pet.stock + addedKg) * 1000) / 1000;
  if (stock > 1000) throw new Error("Остаток корма не может превышать 1000 кг.");
  return {
    ...pet,
    stock,
    stockDate: addedKg > 0 ? onDate : pet.stockDate,
    shopping: pet.shopping.map((s) => s.id === itemId
      ? { ...s, done: true, stockCreditedKg: Math.round(((s.stockCreditedKg ?? 0) + addedKg) * 1000) / 1000 }
      : s),
  };
}
export function restoreShoppingItem(pet: Pet, itemId: string): Pet {
  const item = pet.shopping.find((s) => s.id === itemId);
  if (!item) throw new Error("Покупка не найдена.");
  // Undoing the checklist does not automatically subtract food already delivered.
  return { ...pet, shopping: pet.shopping.map((s) => s.id === itemId ? { ...s, done: false } : s) };
}
