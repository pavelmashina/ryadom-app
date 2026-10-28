import * as webpush from "jsr:@negrel/webpush@0.5.0";

type Job = {
  kind: "event" | "training";
  id: string;
  user_id: string;
  event_id?: string;
  session_id?: string;
  reminder_id: string;
  occurrence_at: string;
  title: string;
  comment: string;
  timezone: string;
};
type Subscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const legacySecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, string>;
const serviceKey = legacySecret || secretKeys.default;
if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are missing");
const base = supabaseUrl + "/rest/v1";
const headers: Record<string, string> = {
  apikey: serviceKey,
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
if (serviceKey.startsWith("eyJ")) headers.Authorization = "Bearer " + serviceKey;

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(base + path, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  if (!res.ok) throw Error("Database API failure: " + res.status);
  if (res.status === 204) return null;
  const contentType = res.headers.get("content-type") || "";
  return contentType.includes("application/json") ? res.json() : null;
}
const rpc = (method: string, body: object = {}) =>
  api("/rpc/" + method, { method: "POST", body: JSON.stringify(body) });
const q = (v: string) => encodeURIComponent(v);
const b64url = (arr: Uint8Array) =>
  btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function from64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function sender() {
  const config = await rpc("push_worker_vapid") as { publicKey?: string; privateKey?: string };
  if (!config?.publicKey || !config?.privateKey) throw Error("VAPID is not configured");
  const bytes = from64(config.publicKey);
  if (bytes.length !== 65 || bytes[0] !== 4) throw Error("Invalid VAPID public key");
  const x = b64url(bytes.slice(1, 33)), y = b64url(bytes.slice(33, 65));
  const jwk = { kty: "EC", crv: "P-256", x, y };
  const pair = await webpush.importVapidKeys({
    publicKey: { ...jwk, ext: true, key_ops: ["verify"] },
    privateKey: { ...jwk, d: config.privateKey, ext: true, key_ops: ["sign"] },
  });
  return webpush.ApplicationServer.new({
    contactInformation: "https://pavelmashina.github.io/ryadom-app/",
    vapidKeys: pair,
  });
}
async function updateDelivery(job: Job, status: string, attempts = 1, error = "") {
  const table = job.kind === "training" ? "training_notification_deliveries" : "notification_deliveries";
  await api("/" + table + "?id=eq." + q(job.id), {
    method: "PATCH",
    body: JSON.stringify({
      status,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      next_attempt_at: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** attempts)).toISOString(),
      last_error: error.slice(0, 160),
    }),
  });
}
/** Resolve the original pet at dispatch time: recipients may have several pets. */
async function notificationText(job: Job): Promise<{ title: string; body: string }> {
  const resource = job.kind === "training" ? "training_sessions" : "calendar_events";
  const targetId = job.kind === "training" ? job.session_id : job.event_id;
  if (!targetId) throw new Error("Notification target is missing");
  const records = await api("/" + resource + "?select=pet_id" +
    (job.kind === "event" ? ",type" : "") + "&id=eq." + q(targetId)) as
    { pet_id: string; type?: string }[];
  const petId = records?.[0]?.pet_id;
  if (!petId) throw new Error("Notification pet is missing");
  const pets = (await api("/pets?select=name&id=eq." + q(petId) + "&deleted_at=is.null")) as { name: string }[];
  const petName = pets?.[0]?.name?.trim();
  if (!petName) throw new Error("Notification pet name is missing");
  const prefix = job.kind === "training" ? "Тренировка" :
    records[0].type === "reminder" ? "Напоминание" : "Событие";
  const body = [prefix + (job.title?.trim() ? ": " + job.title.trim() : ""),
    job.comment?.trim()].filter(Boolean).join(" · ").slice(0, 240);
  return { title: petName.slice(0, 120), body };
}
async function deliver(job: Job, server: webpush.ApplicationServer) {
  const display = await notificationText(job);
  const subs = await api("/push_subscriptions?select=id,endpoint,p256dh,auth&user_id=eq." +
    q(job.user_id)) as Subscription[];
  if (!subs?.length) {
    await updateDelivery(job, "failed", 1, "No subscribed devices");
    return false;
  }
  const deviceTable = job.kind === "training"
    ? "training_notification_device_deliveries" : "notification_device_deliveries";
  const completed = await api(
    "/" + deviceTable + "?select=subscription_id&delivery_id=eq." +
    q(job.id) + "&sent_at=not.is.null",
  ) as { subscription_id: string }[];
  const sent = new Set(completed.map((x) => x.subscription_id));
  let failed = false;
  for (const sub of subs) {
    if (sent.has(sub.id)) continue;
    const message = JSON.stringify({
      title: display.title,
      body: display.body,
      ...(job.kind === "training" ? { trainingId: job.session_id } : { eventId: job.event_id }),
      at: job.occurrence_at,
      icon: "/ryadom-app/icon-192.png",
      url: job.kind === "training"
        ? "/ryadom-app/?training=" + encodeURIComponent(job.session_id || "")
        : "/ryadom-app/?event=" + encodeURIComponent(job.event_id || "") +
          "&date=" + encodeURIComponent(new Date(job.occurrence_at).toLocaleDateString("sv-SE", {
            timeZone: job.timezone,
          })),
    });
    try {
      await server.subscribe({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }).pushTextMessage(message, { ttl: 3600 });
      await api("/" + deviceTable + "?on_conflict=delivery_id,subscription_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          delivery_id: job.id,
          subscription_id: sub.id,
          attempts: 1,
          sent_at: new Date().toISOString(),
          last_error: null,
        }),
      });
    } catch (e) {
      const gone = e instanceof webpush.PushMessageError &&
        (e.response.status === 404 || e.response.status === 410);
      if (gone) {
        await api("/push_subscriptions?id=eq." + q(sub.id), { method: "DELETE" });
        continue;
      }
      failed = true;
      await api("/" + deviceTable + "?on_conflict=delivery_id,subscription_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          delivery_id: job.id,
          subscription_id: sub.id,
          attempts: 1,
          last_error: "Push provider unavailable",
        }),
      });
    }
  }
  await updateDelivery(job, failed ? "failed" : "sent", 1,
    failed ? "Some devices failed" : "");
  return !failed;
}
Deno.serve(async (request: Request) => {
  if (request.method !== "POST")
    return new Response("Method Not Allowed", { status: 405 });
  // Supabase gateway JWT verification is disabled for this scheduled
  // endpoint. Every request is instead validated with the private
  // capability stored in Vault (never included in frontend bundles).
  const token = request.headers.get("x-cron-token") || "";
  if (!token || token.length < 24)
    return new Response("Unauthorized", { status: 401 });
  try {
    const valid = await rpc("push_worker_verify", { token });
    if (valid !== true) return new Response("Unauthorized", { status: 401 });
    if (new URL(request.url).searchParams.get("selftest") === "1") {
      await sender();
      return Response.json({ vapid: "ready", authenticated: true });
    }
    const queued = await rpc("enqueue_due_push");
    const trainingQueued = await rpc("enqueue_due_training_push");
    const events = await rpc("claim_due_push", { max_jobs: 25 }) as Omit<Job, "kind">[];
    const trainings = await rpc("claim_due_training_push", { max_jobs: 25 }) as Omit<Job, "kind">[];
    const jobs: Job[] = [
      ...events.map((job) => ({ ...job, kind: "event" as const })),
      ...trainings.map((job) => ({ ...job, kind: "training" as const })),
    ];
    if (!jobs.length) return Response.json({ queued, trainingQueued, processed: 0 });
    const server = await sender();
    let sent = 0;
    for (const job of jobs) {
      try {
        if (await deliver(job, server)) sent++;
      } catch {
        await updateDelivery(job, "failed", 2, "Push processing failure");
      }
    }
    return Response.json({ queued, trainingQueued, processed: jobs.length, sent });
  } catch {
    return Response.json({ error: "Push worker unavailable" }, { status: 503 });
  }
});
