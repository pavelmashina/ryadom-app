import { useEffect, useState } from "react";
import { Button } from "./components";
import type { AuthSession } from "./backend";
import { appScope, appUrl } from "./app-paths";
import { validateVapidKey } from "./vapid";
import {
  deleteSubscription, getSubscriptions, getVapidPublicKey, saveSubscription,
} from "./push-api";

function browserSupportsPush() {
  return "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    window.isSecureContext;
}
function sameKey(actual: ArrayBuffer | null | undefined, expected: Uint8Array) {
  if (!actual) return false;
  const a = new Uint8Array(actual);
  return a.length === expected.length && a.every((x, i) => x === expected[i]);
}
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(appUrl("sw.js").href, {
    scope: appScope(),
    updateViaCache: "none",
  });
  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(
      () => reject(new Error("Service worker activation timeout")), 15000,
    )),
  ]);
  if (!ready.active || ready.scope !== registration.scope)
    throw new Error("Service worker did not activate for the app scope");
  return ready;
}
function friendlyError(stage: string, permission: NotificationPermission) {
  if (permission === "denied") return "Разрешение на уведомления отключено в настройках браузера.";
  if (stage === "key") return "Не удалось проверить ключ уведомлений. Попробуйте обновить приложение.";
  if (stage === "worker") return "Не удалось запустить уведомления приложения. Перезапустите приложение и попробуйте ещё раз.";
  if (stage === "save") return "Не удалось сохранить подписку. Проверьте интернет и войдите в аккаунт повторно.";
  return "Не удалось включить уведомления. Проверьте разрешения браузера и попробуйте ещё раз.";
}
function debug(stage: string) {
  console.info("[push] " + stage);
}

export function PushSettings({ session }: { session: AuthSession }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const supportsPush = browserSupportsPush();
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const allowedHere = supportsPush && (!ios || installed);

  useEffect(() => {
    if (!allowedHere || Notification.permission !== "granted") return;
    let alive = true;
    void (async () => {
      try {
        const registration = await readyRegistration();
        const [sub, saved] = await Promise.all([
          registration.pushManager.getSubscription(), getSubscriptions(session),
        ]);
        if (alive) setEnabled(
          !!sub && saved.some((x) => x.endpoint === sub.endpoint),
        );
      } catch (cause) {
        console.warn("[push] subscription state check failed", cause);
        if (alive) setEnabled(false);
      }
    })();
    return () => { alive = false; };
  }, [allowedHere, session.user.id]);

  async function subscribe() {
    if (!allowedHere) {
      setError("Уведомления не поддерживаются в этом браузере.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    let stage = "permission";
    try {
      if (Notification.permission === "denied") {
        setError("Разрешение на уведомления отключено в настройках браузера.");
        return;
      }
      if (Notification.permission !== "granted") {
        debug("permission requested");
        // The native permission dialog must be called directly from the click.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setError(permission === "denied"
            ? "Разрешение на уведомления отключено в настройках браузера."
            : "Разрешение на уведомления не предоставлено.");
          return;
        }
      }
      debug("permission granted");
      stage = "worker";
      const registration = await readyRegistration();
      debug("service worker ready");
      stage = "key";
      const key = await validateVapidKey(await getVapidPublicKey(session));
      debug("vapid key parsed");
      stage = "subscribe";
      let current = await registration.pushManager.getSubscription();
      if (current && !sameKey(current.options?.applicationServerKey, key)) {
        // A stale subscription registered with a different VAPID key cannot
        // reliably receive pushes signed by this backend.
        await deleteSubscription(session, current.endpoint);
        await current.unsubscribe();
        current = null;
      }
      const sub = current ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      debug(current ? "existing subscription reused" : "subscription created");
      stage = "save";
      // Preserve the browser subscription even if the network response fails:
      // PostgREST might have committed the row already. Retrying with the same
      // endpoint is idempotent and prevents a new orphan row on every tap.
      await saveSubscription(session, sub);
      debug("subscription saved");
      setEnabled(true);
      setNotice("Уведомления включены для этого устройства.");
    } catch (cause) {
      console.error("[push] enable failed at stage: " + stage, cause);
      setError(friendlyError(stage, Notification.permission));
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    if (!allowedHere) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const registration = await readyRegistration();
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await deleteSubscription(session, sub.endpoint);
        await sub.unsubscribe();
      }
      setEnabled(false);
      setNotice("Уведомления выключены на этом устройстве.");
    } catch (cause) {
      console.error("[push] unsubscribe failed", cause);
      setError("Не удалось выключить уведомления. Проверьте интернет и повторите попытку.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="push-settings">
      <p className="hint">
        Напоминания о событиях питомца. Подписка относится только к вашему
        аккаунту и этому устройству.
      </p>
      {!supportsPush && (
        <p className="hint">Уведомления не поддерживаются в этом браузере.</p>
      )}
      {ios && !installed && (
        <p className="hint">
          На iPhone и iPad добавьте приложение на экран «Домой» и запустите
          оттуда, чтобы включить уведомления.
        </p>
      )}
      <Button
        disabled={!allowedHere || busy}
        loading={busy}
        onClick={() => void (enabled ? unsubscribe() : subscribe())}
      >
        {enabled ? "Выключить уведомления" : "Включить уведомления"}
      </Button>
      {notice && <p className="hint" role="status">{notice}</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </div>
  );
}
