import { appScope, appUrl } from "./app-paths";
import { useEffect, useState, Component, type ReactNode } from "react";
export function repairApp() {
  window.dispatchEvent(new Event("ryadom:repair"));
}
export class StartupBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="cloud-screen">
        <div className="cloud-card">
          <h1>Не удалось открыть приложение</h1>
          <p>Попробуйте восстановить загрузку.</p>
          <button className="btn btn-primary" onClick={repairApp}>
            Восстановить загрузку
          </button>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function PwaLifecycle() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    window.dispatchEvent(new Event("ryadom:ready"));
    if (
      !("serviceWorker" in navigator) ||
      /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    )
      return;
    let disposed = false,
      registration: ServiceWorkerRegistration | undefined,
      lastCheck = 0;
    const check = () => {
      if (
        document.visibilityState === "visible" &&
        registration &&
        Date.now() - lastCheck > 60000
      ) {
        lastCheck = Date.now();
        void registration.update().catch(() => {});
      }
    };
    void navigator.serviceWorker
      .register(appUrl("sw.js").href, {
        scope: appScope(),
        updateViaCache: "none",
      })
      .then((r) => {
        if (disposed) return;
        registration = r;
        const notice = () => {
          if (!disposed && r.waiting) setWaiting(r.waiting);
        };
        notice();
        r.addEventListener("updatefound", () => {
          r.installing?.addEventListener("statechange", notice);
        });
        check();
      })
      .catch((error) => console.warn("Не удалось проверить обновление", error));
    document.addEventListener("visibilitychange", check);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  function update() {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => location.reload(),
      { once: true },
    );
    waiting.postMessage({ type: "ACTIVATE_UPDATE" });
  }
  return waiting ? (
    <div className="pwa-update" role="status">
      <span>Доступно обновление. Сохраните изменения перед обновлением.</span>
      <button className="btn btn-secondary" onClick={update}>
        Обновить
      </button>
    </div>
  ) : null;
}
