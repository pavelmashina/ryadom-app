import { rpc, type AuthSession } from "./backend";
export type AccessResult = {
  name: string;
  status: "active" | "pending" | "available";
};
export type OutgoingRequest = {
  id: string;
  name: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  created_at: string;
};
export type AccessDetails = {
  members: { user_id: string; email: string; role: "owner" | "editor" }[];
  requests: { id: string; email: string; created_at: string }[];
};
export async function petAccess<T>(
  session: AuthSession,
  action: string,
  args: { code?: string; target?: string; subject?: string } = {},
): Promise<T> {
  const result = (await rpc(session, "pet_access", {
    action,
    ...args,
  })) as T & { error?: string };
  if (result?.error) throw new Error(result.error);
  return result;
}
