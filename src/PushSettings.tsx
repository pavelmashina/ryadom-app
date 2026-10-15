import { useEffect, useState } from "react";
import { Button } from "./components";
import type { AuthSession } from "./backend";
import {
  deleteSubscription, getSubscriptions, getVapidPublicKey, saveSubscription,
} from "./push-api";

function base64Key(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(decoded, (ch) => ch.charCodeAt(0));
}
export function PushSettings({ session }: { session: AuthSession }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const supportsPush = "serviceWorker" in navigator &&
    "PushManager" in window && "Notification" in window;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  useEffect(() => {
    if (!supportsPush) return;
    let active = true;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const [subscription, saved] = await Promise.all([
          registration.pushManager.getSubscription(), getSubscriptions(session),
        ]);
        if (active) setEnabled(
          !!subscription && saved.some((x) => x.endpoint === subscription.endpoint),
        );
      } catch {
        if (active) setEnabled(false);
      }
    })();
    return () => { active = false; };
  }, [session.user.id]);

  async function subscribe() {
    if (!supportsPush) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // This call must follow a direct button click, never a page-load effect.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw Error(
        "Разрешение не предоставлено. Его можно изменить в настройках устройства.",
      );
      const publicKey = await getVapidPublicKey(session);
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      const sub = current ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64Key(publicKey),
      });
      try {
        await saveSubscription(session, sub);
      } catch (e) {
        // Roll back a new browser subscription if the server rejected it.
        if (!current) await sub.unsubscribe();
        throw e;
      }
      setEnabled(true);
      setNotice("Уведомления включены для этого устройства.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось включить уведомления");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await deleteSubscription(session, sub.endpoint);
        await sub.unsubscribe();
      }
      setEnabled(false);
      setNotice("Уведомления выключены на этом устройстве.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выключить уведомления");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="push-settings">
      <p className="hint">
        Получайте напоминания о событиях питомца. Настройки относятся только
        к вашему аккаунту и этому устройству.
      </p>
      {!supportsPush && (
        <p className="hint">Этот браузер не поддерживает Web Push.</p>
      )}
      {ios && !installed && (
        <p className="hint">
          На iPhone и iPad установите приложение на экран «Домой», затем откройте
          его оттуда, чтобы включить push-уведомления.
        </p>
      )}
      <Button
        disabled={!supportsPush || (ios && !installed) || busy}
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
