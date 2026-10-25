import type { AuthSession } from "./backend";

/** Deliver invitations server-side: never expose the provider key in the client. */
export async function sendPetInvitation(session: AuthSession, petId: string, email: string): Promise<void> {
  const recipient = email.trim();
  if (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
    throw new Error("Введите корректный адрес электронной почты.");
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey)
    throw new Error("Сервис приглашений не настроен.");

  let response: Response;
  try {
    response = await fetch(supabaseUrl + "/functions/v1/pet-invitation-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": publishableKey,
        "Authorization": "Bearer " + session.accessToken,
      },
      body: JSON.stringify({ target: petId, email: recipient }),
    });
  } catch {
    throw new Error("Нет соединения с почтовым сервисом. Попробуйте позже.");
  }
  const payload = await response.json().catch(() => ({})) as {
    accepted?: boolean;
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error || "Не удалось отправить приглашение.");
  if (payload.accepted !== true)
    throw new Error("Почтовый сервис не подтвердил отправку.");
}
