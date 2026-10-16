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
export function invitationMailto(email: string, petName: string, url: string): string {
  const recipient = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254)
    throw new Error("Введите корректный адрес электронной почты.");
  const subject = "Приглашение в Рядом — " + petName;
  const body = "Приглашаю вас вместе заботиться о питомце «" + petName +
    "» в приложении «Рядом».\n\n" +
    "Перейдите по ссылке, войдите в аккаунт и отправьте запрос на доступ. " +
    "После подтверждения мной вы сможете видеть и обновлять данные питомца.\n\n" +
    url + "\n\nПожалуйста, не пересылайте ссылку посторонним.";
  return "mailto:" + encodeURIComponent(recipient) +
    "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
}
