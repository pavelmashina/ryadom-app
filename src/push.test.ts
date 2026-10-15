import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function pushHarness() {
  const events: Record<string, (event: any) => void> = {};
  const notifications: { title: string; options: any }[] = [];
  const opened: string[] = [];
  const source = readFileSync(
    new URL("../scripts/service-worker.mjs", import.meta.url), "utf8",
  );
  const generate = runInNewContext(
    source.replace("export function", "function") +
      ';serviceWorkerSource("ryadom-test",["/ryadom-app/index.html"])',
  );
  const self = {
    location: { origin: "https://example.test" },
    skipWaiting: vi.fn(),
    addEventListener(name: string, handler: (event: any) => void) {
      events[name] = handler;
    },
    registration: {
      showNotification(title: string, options: any) {
        notifications.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url: string) => { opened.push(url); },
    },
  };
  runInNewContext(generate, {
    self, URL, Promise, Response, AbortController, setTimeout, clearTimeout,
    caches: { open: async () => ({}), keys: async () => [] },
    fetch: vi.fn(),
    Request,
  });
  async function dispatch(name: string, fields: Record<string, unknown>) {
    let pending: Promise<unknown> = Promise.resolve();
    events[name]({ ...fields, waitUntil(value: Promise<unknown>) { pending = value; } });
    await pending;
  }
  return { events, notifications, opened, dispatch };
}

describe("PWA Web Push handling", () => {
  it("registers push and click handlers without asking for permission", () => {
    const h = pushHarness();
    expect(h.events.push).toBeTypeOf("function");
    expect(h.events.notificationclick).toBeTypeOf("function");
    const settings = readFileSync(
      new URL("./PushSettings.tsx", import.meta.url), "utf8",
    );
    expect(settings).toContain("Notification.requestPermission()");
    expect(settings).toContain("async function subscribe()");
  });
  it("displays a notification with a deep link to the pet event", async () => {
    const h = pushHarness();
    await h.dispatch("push", {
      data: { json: () => ({
        title: "Ветеринар",
        body: "Запланирован приём",
        eventId: "event-id",
        at: "2026-10-15T12:00:00Z",
        url: "/ryadom-app/?event=event-id&date=2026-10-15",
      }) },
    });
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0].title).toBe("Ветеринар");
    expect(h.notifications[0].options.data.url).toContain("event=event-id");
  });
  it("refuses notification navigation outside the app origin", async () => {
    const h = pushHarness();
    await h.dispatch("push", {
      data: { json: () => ({ title: "Reminder", url: "https://evil.test/steal" }) },
    });
    expect(h.notifications[0].options.data.url)
      .toBe("https://example.test/ryadom-app/");
  });
  it("opens a notification target after the user taps it", async () => {
    const h = pushHarness();
    const close = vi.fn();
    await h.dispatch("notificationclick", {
      notification: {
        close,
        data: { url: "https://example.test/ryadom-app/?event=one" },
      },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(h.opened).toEqual(["https://example.test/ryadom-app/?event=one"]);
  });
});
