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
/** Only unanswered access requests belong in the Add Existing Pet dialog. */
export function pendingAccessRequests(requests: OutgoingRequest[]): OutgoingRequest[] {
  return requests.filter(request => request.status === "pending");
}
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

export async function getPetMembers(
  session: AuthSession,
  target: string,
): Promise<AccessDetails["members"]> {
  const result = await rpc(session, "pet_members_summary", { target });
  if (!Array.isArray(result)) throw new Error("Не удалось загрузить список участников.");
  return result as AccessDetails["members"];
}
