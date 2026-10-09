import type { Pet } from "./domain";
import type { TrainingSession } from "./training-domain";
export function setCommandArchived(
  pet: Pet,
  commandId: string,
  archived: boolean,
): Pet {
  if (!pet.commands.some((c) => c.id === commandId))
    throw new Error("Команда не найдена");
  return {
    ...pet,
    commands: pet.commands.map((c) =>
      c.id === commandId ? { ...c, archived } : c,
    ),
  };
}
export function selectableCommands(
  commands: Pet["commands"],
  session?: TrainingSession,
) {
  const historical = new Set(session?.results.map((r) => r.command_id) ?? []);
  return commands.filter((c) => !c.archived || historical.has(c.id));
}
