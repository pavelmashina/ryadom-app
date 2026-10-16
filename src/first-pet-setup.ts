import type { Pet, State } from "./domain";

/** Only the unmodified placeholder of a brand-new account needs onboarding. */
export function needsFirstPetSetup(state: State): boolean {
  if (state.pets.length !== 1) return false;
  const pet = state.pets[0];
  return !pet.demo && pet.role !== "editor" && !pet.onboardingCompleted &&
    pet.name === "Мой питомец" && !pet.breed && !pet.birthday &&
    !pet.sex && !pet.chip &&
    !pet.events.length && !pet.commands.length && !pet.sessions.length &&
    !pet.workouts.length && !(pet.trainingSchedules?.length) &&
    !pet.weights.length && !pet.records.length &&
    !pet.documents.length && !pet.shopping.length &&
    !pet.stock && !pet.ration;
}

export type PetBasics = Pick<Pet, "name" | "breed" | "birthday" | "sex" | "chip">;
