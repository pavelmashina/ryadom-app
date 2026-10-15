/** Supabase PostgREST can return 201 Created with an empty body when
 * Prefer: return=minimal is used. Do not assume every successful reply is JSON.
 */
export async function parsePushApiResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    // Keep the detailed PostgREST code in developer logs, not the UI.
    let code = "unknown";
    try {
      const raw = await response.text();
      const details = JSON.parse(raw) as { code?: unknown };
      if (typeof details.code === "string") code = details.code;
    } catch {
      // Network gateways can return HTML/plain-text errors.
    }
    console.warn("[push] Supabase request rejected", {
      status: response.status,
      code,
    });
    throw new Error("Не удалось выполнить запрос к серверу уведомлений (" +
      response.status + ")");
  }

  if (response.status === 204 || response.status === 205) return null;
  const body = await response.text();
  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("Сервер уведомлений вернул некорректный ответ");
  }
}
