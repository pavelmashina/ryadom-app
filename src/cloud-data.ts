import { initialState, stateSchema, type State, type Pet } from "./domain";
import { rpc, type AuthSession } from "./backend";
export type CloudSnapshot = { state: State; revision: number; tag?: string };
function petData(p: Pet) {
  const { shareCode, role, revision, pendingRequests, ...data } = p;
  return data;
}
export function sharedChanges(next: State, before?: State) {
  return {
    changes: next.pets.flatMap((p) => {
      const old = before?.pets.find((x) => x.id === p.id);
      if (old && JSON.stringify(petData(old)) === JSON.stringify(petData(p)))
        return [];
      return [{ pet: petData(p), revision: old?.revision ?? null }];
    }),
    removed:
      before?.pets
        .filter((p) => !next.pets.some((x) => x.id === p.id))
        .map((p) => ({ id: p.id, revision: p.revision })) ?? [],
    selected_pet: next.selectedPet,
  };
}
function snapshot(result: unknown): CloudSnapshot {
  const value = result as { state: unknown; tag?: string };
  return { state: stateSchema.parse(value.state), revision: 0, tag: value.tag };
}
export async function loadAccount(
  session: AuthSession,
  previous?: CloudSnapshot,
): Promise<CloudSnapshot> {
  if (
    previous?.tag &&
    (await rpc(session, "shared_state_tag", {})) === previous.tag
  )
    return previous;
  const result = (await rpc(session, "load_shared_state", {})) as {
    state: { pets: unknown[] };
  };
  if (!result.state.pets.length) return saveAccount(session, initialState());
  return snapshot(result);
}
export async function saveAccount(
  session: AuthSession,
  state: State,
  before?: State,
): Promise<CloudSnapshot> {
  return snapshot(
    await rpc(
      session,
      "save_shared_state",
      sharedChanges(stateSchema.parse(state), before),
    ),
  );
}
