/** Sends one owner-authorized pet invitation. No mailbox credentials reach the browser. */
type PreparedInvitation = {
  pet_name: string;
  share_code: string;
  sender_email: string;
  recipient_email: string;
};
const appOrigin = "https://pavelmashina.github.io";
const appUrl = appOrigin + "/ryadom-app/";
const allowedOrigins = new Set([appOrigin, "http://localhost:5173", "http://127.0.0.1:5173"]);
const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}") as Record<string, string>;
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
  publishableKeys.default || Object.values(publishableKeys)[0];
const providerKey = Deno.env.get("RESEND_API_KEY");
const senderAddress = Deno.env.get("PET_INVITE_FROM_EMAIL")?.trim();

function cors(origin: string | null): HeadersInit {
  return {
    ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}
function reply(origin: string | null, status: number, error: string, extra: object = {}) {
  return new Response(JSON.stringify({ error, ...extra }), {
    status, headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}
const isEmail = (value: string) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);

/** All invitations use identical copy; only sender, recipient, pet and link vary. */
function invitationContents(details: PreparedInvitation) {
  const url = new URL(appUrl);
  url.searchParams.set("join", details.share_code);
  const link = url.toString();
  const name = details.pet_name;
  const sender = details.sender_email;
  const to = details.recipient_email;
  const subject = `Приглашение в «Рядом» — ${name}`;
  const text = [
    "Здравствуйте!",
    "",
    `${sender} приглашает вас получить совместный доступ к питомцу «${name}» в приложении «Рядом».`,
    "",
    "Чтобы запросить доступ, откройте ссылку, войдите или зарегистрируйтесь и отправьте запрос владельцу:",
    link,
    "",
    "Доступ к данным появится только после подтверждения владельцем.",
    "",
    `Отправитель: ${sender}`,
    `Получатель: ${to}`,
    "",
    "Это автоматическое письмо от приложения «Рядом». Если приглашение пришло по ошибке, просто проигнорируйте его.",
  ].join("\n");
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#f7f6ee;font-family:Arial,sans-serif;color:#293f32"><main style="max-width:560px;margin:auto;padding:24px;background:#fffef9;border:1px solid #d6ddcf;border-radius:12px"><h1 style="font-size:22px;font-weight:600;margin:0 0 20px">Приглашение в «Рядом»</h1><p><strong>${escapeHtml(sender)}</strong> приглашает вас получить совместный доступ к питомцу <strong>«${escapeHtml(name)}»</strong>.</p><p>Откройте ссылку, войдите или зарегистрируйтесь и отправьте запрос владельцу питомца.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#345941;color:#fffef9;text-decoration:none;padding:12px 20px;border-radius:8px">Запросить доступ</a></p><p style="font-size:14px">Доступ появится только после подтверждения владельцем.</p><hr style="border:0;border-top:1px solid #d6ddcf;margin:20px 0"><p style="font-size:12px;color:#576653">Отправитель: ${escapeHtml(sender)}<br>Получатель: ${escapeHtml(to)}</p><p style="font-size:12px;color:#576653">Автоматическое письмо от «Рядом». Если приглашение пришло по ошибке, проигнорируйте его.</p></main></body></html>`;
  return { subject, text, html };
}
Deno.serve(async request => {
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigins.has(origin)) return reply(origin, 403, "Недопустимый источник запроса.");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "POST") return reply(origin, 405, "Метод не поддерживается.");
  if (!supabaseUrl || !publicKey) return reply(origin, 503, "Почтовая отправка временно недоступна.");
  if (!providerKey || !senderAddress || !isEmail(senderAddress))
    return reply(origin, 503, "Отправка приглашений ещё не настроена. Требуются RESEND_API_KEY и PET_INVITE_FROM_EMAIL (подтверждённый домен).");

  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer \S+$/.test(authorization)) return reply(origin, 401, "Войдите в аккаунт, чтобы отправлять приглашения.");
  let body: { target?: unknown; email?: unknown };
  try { body = await request.json(); }
  catch { return reply(origin, 400, "Некорректные данные приглашения."); }
  if (typeof body.target !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(body.target) ||
    typeof body.email !== "string" || !isEmail(body.email.trim()))
    return reply(origin, 400, "Введите корректный адрес электронной почты.");

  const headers = { "apikey": publicKey, "Authorization": authorization, "Content-Type": "application/json" };
  try {
    const identity = await fetch(supabaseUrl + "/auth/v1/user", { headers });
    if (!identity.ok) return reply(origin, 401, "Сеанс завершён. Войдите в аккаунт снова.");
    const prepared = await fetch(supabaseUrl + "/rest/v1/rpc/prepare_pet_email_invitation", {
      method: "POST", headers,
      body: JSON.stringify({ target: body.target, email: body.email.trim() }),
    });
    if (!prepared.ok) {
      const error = await prepared.json().catch(() => ({})) as { message?: string };
      const message = error.message || "Не удалось создать приглашение.";
      const status = prepared.status === 403 || prepared.status === 401 ? 403 :
        /лимит|недавно|минут/i.test(message) ? 429 : 400;
      return reply(origin, status, message);
    }
    const details = await prepared.json() as PreparedInvitation;
    if (!/^RYD-[A-Z0-9]{10}$/.test(details.share_code) ||
      !isEmail(details.sender_email) || !isEmail(details.recipient_email) || !details.pet_name)
      return reply(origin, 500, "Не удалось получить данные приглашения.");

    const { subject, text, html } = invitationContents(details);
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${providerKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Рядом <${senderAddress}>`,
        reply_to: details.sender_email,
        to: [details.recipient_email],
        subject, text, html,
      }),
    });
    const result = await sent.json().catch(() => ({})) as { id?: string };
    if (!sent.ok || !result.id)
      return reply(origin, 502, "Почтовый сервис не принял приглашение. Попробуйте позже.");
    return new Response(JSON.stringify({ accepted: true }), {
      status: 200, headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return reply(origin, 503, "Не удалось связаться с почтовым сервисом. Попробуйте позже.");
  }
});
