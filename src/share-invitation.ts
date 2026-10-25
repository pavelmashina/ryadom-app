/** A share code is not access by itself: recipients must sign in and
 * the pet owner still approves the access request.
 */
export function inviteLink(origin: string, appBase: string, code: string): string {
  const value = code.trim().toUpperCase();
  if (!/^RYD-[A-Z0-9]{10}$/.test(value))
    throw new Error("ID питомца недоступен. Обновите карточку.");
  const base = new URL(appBase, origin);
  if (base.origin !== new URL(origin).origin)
    throw new Error("Недопустимый адрес приложения.");
  const result = new URL(base.toString());
  result.searchParams.set("join", value);
  return result.toString();
}
export function joinCodeFromUrl(search: string): string | null {
  const code = new URLSearchParams(search).get("join");
  return code && /^RYD-[A-Z0-9]{10}$/i.test(code) ? code.toUpperCase() : null;
}
