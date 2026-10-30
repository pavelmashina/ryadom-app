import type { Pet } from "./domain";

export function saveWeight(pet: Pet, entry: Pet["weights"][number]): Pet {
  const exists = pet.weights.some((w) => w.id === entry.id);
  return {
    ...pet,
    weights: exists
      ? pet.weights.map((w) => w.id === entry.id ? entry : w)
      : [...pet.weights, entry],
  };
}
export function deleteWeight(pet: Pet, entryId: string): Pet {
  if (!pet.weights.some((w) => w.id === entryId))
    throw new Error("Измерение уже удалено или недоступно.");
  return { ...pet, weights: pet.weights.filter((w) => w.id !== entryId) };
}

export function saveMedicalRecord(pet: Pet, entry: Pet["records"][number]): Pet {
  const exists = pet.records.some((r) => r.id === entry.id);
  return {
    ...pet,
    records: exists
      ? pet.records.map((r) => r.id === entry.id ? entry : r)
      : [...pet.records, entry],
  };
}
export function deleteMedicalRecord(pet: Pet, entryId: string): Pet {
  if (!pet.records.some((r) => r.id === entryId))
    throw new Error("Медицинская запись уже удалена или недоступна.");
  return {
    ...pet,
    records: pet.records.filter((r) => r.id !== entryId),
    // Preserve uploaded files in Documents even if their medical entry is removed.
    documents: pet.documents.map((doc) => doc.linkedRecord === entryId
      ? { ...doc, linkedRecord: undefined } : doc),
    // Keep appointments, but never point them at a removed medical record.
    events: pet.events.map((event) => event.linkedRecord === entryId
      ? { ...event, linkedRecord: undefined } : event),
  };
}
export function deletePetDocument(pet: Pet, entryId: string): Pet {
  if (!pet.documents.some((doc) => doc.id === entryId))
    throw new Error("Документ уже удалён или недоступен.");
  return { ...pet, documents: pet.documents.filter((doc) => doc.id !== entryId) };
}
