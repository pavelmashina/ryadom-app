import { parsePushApiResponse } from "./push-response";
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
  const server = new URL(apiRoot);
  if (server.protocol !== "https:" && server.hostname !== "localhost")
    throw new Error("Некорректный адрес сервера");
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
  return parsePushApiResponse(response);
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
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(json.endpoint);
  } catch {
    throw new Error("Браузер вернул некорректный адрес push-сервиса");
  }
  if (endpointUrl.protocol !== "https:" || !endpointUrl.hostname ||
      endpointUrl.username || endpointUrl.password ||
      !/^[A-Za-z0-9_-]+={0,2}$/.test(json.keys.p256dh) ||
      !/^[A-Za-z0-9_-]+={0,2}$/.test(json.keys.auth)) {
    throw new Error("Браузер вернул некорректные данные push-подписки");
  }
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

export type NotificationPreferences = {
  user_id: string;
  trainings_enabled: boolean;
  events_enabled: boolean;
  reminders_enabled: boolean;
  training_offset_minutes: number;
};

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  trainings_enabled: false,
  events_enabled: true,
  reminders_enabled: true,
  training_offset_minutes: 60,
} as const;

export async function getNotificationPreferences(session: AuthSession): Promise<NotificationPreferences> {
  const result = await rest(session,
    "notification_preferences?select=user_id,trainings_enabled,events_enabled,reminders_enabled,training_offset_minutes&user_id=eq." +
    encodeURIComponent(session.user.id),
  ) as NotificationPreferences[];
  return result[0] ?? { user_id: session.user.id, ...DEFAULT_NOTIFICATION_PREFERENCES };
}

export async function updateNotificationPreferences(
  session: AuthSession,
  prefs: Omit<NotificationPreferences, "user_id">,
): Promise<void> {
  if (!Number.isSafeInteger(prefs.training_offset_minutes) ||
      prefs.training_offset_minutes < 0 || prefs.training_offset_minutes > 10080)
    throw new Error("Некорректное время уведомления о тренировке");
  await rest(session, "notification_preferences?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ ...prefs, user_id: session.user.id }),
  });
}

export type SharedEventReminder = {
  id: string;
  event_id: string;
  user_id: string;
  offset_value: number;
  offset_unit: "minutes" | "hours" | "days" | "weeks";
  enabled: boolean;
};
/** A single effective reminder is shared by the pet's active participants. */
export async function getSharedEventReminder(session: AuthSession, eventId: string): Promise<SharedEventReminder[]> {
  return await rest(session, "rpc/get_shared_event_reminder", {
    method: "POST",
    body: JSON.stringify({ p_event: eventId }),
  }) as SharedEventReminder[];
}
export async function setSharedEventReminder(
  session: AuthSession, _petId: string, eventId: string, minutes: number, enabled: boolean,
): Promise<void> {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 525600)
    throw new Error("Некорректное время напоминания");
  await rest(session, "rpc/set_shared_event_reminder", {
    method: "POST",
    body: JSON.stringify({ p_event: eventId, p_minutes: minutes, p_enabled: enabled }),
  });
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

export type TrainingReminderTarget =
  | { sessionId: string; scheduleId?: never }
  | { scheduleId: string; sessionId?: never };
export type TrainingReminder = {
  id: string;
  user_id: string;
  pet_id: string;
  session_id: string | null;
  schedule_id: string | null;
  offset_value: number;
  offset_unit: "minutes" | "hours" | "days" | "weeks";
  enabled: boolean;
};
function trainingReminderPath(session: AuthSession, petId: string, target: TrainingReminderTarget) {
  if (!!target.sessionId === !!target.scheduleId)
    throw new Error("Выберите одно занятие или один график для напоминания.");
  const field = target.sessionId ? "session_id" : "schedule_id";
  const targetId = target.sessionId ?? target.scheduleId!;
  if (!/^[0-9a-f-]{36}$/i.test(targetId))
    throw new Error("Некорректный ID занятия.");
  return "training_reminders?select=id,user_id,pet_id,session_id,schedule_id,offset_value,offset_unit,enabled" +
    "&user_id=eq." + encodeURIComponent(session.user.id) +
    "&pet_id=eq." + encodeURIComponent(petId) +
    "&" + field + "=eq." + encodeURIComponent(targetId);
}
export async function getTrainingReminder(
  session: AuthSession, petId: string, target: TrainingReminderTarget,
): Promise<TrainingReminder | null> {
  const rows = await rest(session, trainingReminderPath(session, petId, target)) as TrainingReminder[];
  return rows[0] ?? null;
}
export async function setTrainingReminder(
  session: AuthSession, petId: string, target: TrainingReminderTarget,
  minutes: number, enabled: boolean,
): Promise<void> {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 525600)
    throw new Error("Некорректное время напоминания.");
  const existing = await getTrainingReminder(session, petId, target);
  if (existing) {
    await rest(session, "training_reminders?id=eq." + encodeURIComponent(existing.id), {
      method: "PATCH",
      body: JSON.stringify({
        offset_value: minutes, offset_unit: "minutes", enabled,
        source: "personal",
        updated_at: new Date().toISOString(),
      }),
    });
  } else if (enabled) {
    await rest(session, "training_reminders", {
      method: "POST",
      body: JSON.stringify({
        user_id: session.user.id,
        pet_id: petId,
        session_id: target.sessionId ?? null,
        schedule_id: target.scheduleId ?? null,
        offset_value: minutes, offset_unit: "minutes", enabled: true,
      }),
    });
  }
}
