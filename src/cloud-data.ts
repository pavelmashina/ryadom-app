import { initialState, stateSchema, type State } from "./domain";
import { rpc, type AuthSession } from "./backend";
export type CloudSnapshot = { state: State; revision: number };
export async function loadAccount(session: AuthSession): Promise<CloudSnapshot> {
  const result = await rpc(session, "load_app_state", {}) as { state: unknown | null; revision: number; legacy: boolean };
  const state = result.state ? stateSchema.parse(result.state) : initialState();
  if(result.legacy || !result.state) return saveAccount(session, state, result.revision);
  return {state,revision:result.revision};
}
export async function saveAccount(session: AuthSession, state: State, revision: number): Promise<CloudSnapshot> {
  const parsed=stateSchema.parse(state);
  const result=await rpc(session,"save_app_state",{payload:parsed,expected_revision:revision}) as number;
  return {state:parsed,revision:result};
}
