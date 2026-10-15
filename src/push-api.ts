import { appScope } from "./app-paths";
import { getValidSession, type AuthSession } from "./backend";

const apiRoot = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function rest(
  session: AuthSession,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  if (!apiRoot || !apiKey) throw new Error("Supabase не настроен");
  const active = await getValidSession();
  if (!active || active.user.id !== session.user.id)
    throw new Error("Авторизуйтесь повторно для настройки уведомлений");
  const response = await fetch(new URL("rest/v1/" + path, apiRoot + "/").href, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: apiKey,
      Authorization: "Bearer " + active.accessToken,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error("Не удалось сохранить настройки уведомлений (" + response.status + ")");
  return response.status === 204 ? null : response.json();
}

export async function getVapidPublicKey(session: AuthSession) {
  const rows = (await rest(session, "push_public_config?select=public_key&id=eq.true")) as { public_key: string }[];
  if (!rows?.[0]?.public_key) throw new Error("Сервер уведомлений не настроен");
  return rows[0].public_key;
}

export type SavedSubscription = {
  id: string;
  endpoint: string;
};
export async function getSubscriptions(session: AuthSession) {
  return await rest(
    session,
    "push_subscriptions?select=id,endpoint&user_id=eq." + encodeURIComponent(session.user.id),
  ) as SavedSubscription[];
}
export async function saveSubscription(
  session: AuthSession,
  subscription: PushSubscription,
) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
    throw new Error("Браузер не предоставил данные подписки");
  const device_name = /iPad/i.test(navigator.userAgent) ? "iPad"
    : /iPhone/i.test(navigator.userAgent) ? "iPhone"
    : /Android/i.test(navigator.userAgent) ? "Android"
    : "Компьютер";
  await rest(session, "push_subscriptions?on_conflict=endpoint", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: session.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      device_name,
      updated_at: new Date().toISOString(),
    }),
  });
}
export async function deleteSubscription(session: AuthSession, endpoint: string) {
  await rest(session,
    "push_subscriptions?user_id=eq." + encodeURIComponent(session.user.id) +
    "&endpoint=eq." + encodeURIComponent(endpoint), { method: "DELETE" });
}

export type PersonalReminder = {
  id: string;
  event_id: string;
  user_id: string;
  offset_value: number;
  offset_unit: "minutes" | "hours" | "days" | "weeks";
  enabled: boolean;
};
export async function getPersonalReminders(session: AuthSession, eventId: string) {
  return await rest(session, "event_reminders?select=id,event_id,user_id,offset_value,offset_unit,enabled" +
    "&event_id=eq." + encodeURIComponent(eventId) +
    "&user_id=eq." + encodeURIComponent(session.user.id) +
    "&source=eq.native") as PersonalReminder[];
}
export async function setPersonalReminder(
  session: AuthSession,
  petId: string,
  eventId: string,
  minutes: number,
  enabled: boolean,
) {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 525600)
    throw new Error("Некорректное время напоминания");
  const existing = await getPersonalReminders(session, eventId);
  if (existing.length) {
    await rest(session,
      "event_reminders?id=eq." + encodeURIComponent(existing[0].id), {
        method: "PATCH",
        body: JSON.stringify({ offset_value: minutes, offset_unit: "minutes", enabled }),
      });
  } else if (enabled) {
    await rest(session, "event_reminders", {
      method: "POST",
      body: JSON.stringify({
        user_id: session.user.id,
        pet_id: petId,
        event_id: eventId,
        offset_value: minutes,
        offset_unit: "minutes",
        enabled: true,
        source: "native",
      }),
    });
  }
}

/** Drop this device's push subscription before signing out on shared devices. */
export async function revokeDevicePushOnLogout(session: AuthSession) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.getRegistration(appScope());
  const sub = await registration?.pushManager.getSubscription();
  if (!sub) return;
  try {
    await deleteSubscription(session, sub.endpoint);
  } finally {
    // Never keep receiving private pet notifications after local logout.
    await sub.unsubscribe();
  }
}
