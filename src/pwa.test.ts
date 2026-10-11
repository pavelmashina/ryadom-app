import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
function harness() {
  const stores = new Map<string, Map<string, Response>>(),
    events: Record<string, (e: any) => void> = {};
  const fetched: any[] = [];
  const fetcher = vi.fn(async (_r: any, _o?: any): Promise<Response> => {
    throw Error("offline");
  });
  const key = (r: any) => (typeof r === "string" ? r : r.url);
  const cache = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return {
      match: async (r: any) => stores.get(name)!.get(key(r)),
      addAll: async (rs: any[]) => {
        fetched.push(...rs);
      },
    };
  };
  const caches = {
    open: async (n: string) => cache(n),
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  };
  const skipWaiting = vi.fn();
  const self = {
    location: { origin: "https://example.test" },
    skipWaiting,
    addEventListener: (n: string, fn: any) => (events[n] = fn),
  };
  class RequestMock {
    url: string;
    cache: string;
    constructor(url: string, options: any) {
      this.url = url;
      this.cache = options.cache;
    }
  }
  const source = readFileSync(
    new URL("../scripts/service-worker.mjs", import.meta.url),
    "utf8",
  );
  const code = runInNewContext(
    source.replace("export function", "function") +
      ';serviceWorkerSource("ryadom-shell-new",["/ryadom-app/index.html","/ryadom-app/assets/new.js"])',
  );
  runInNewContext(code, {
    self,
    caches,
    fetch: fetcher,
    URL,
    Response,
    Request: RequestMock,
    AbortController,
    setTimeout,
    clearTimeout,
    Set,
    Promise,
  });
  async function dispatch(n: string, data: any = {}) {
    let promise: any;
    events[n]({
      ...data,
      waitUntil: (p: any) => (promise = p),
      respondWith: (p: any) => (promise = p),
    });
    return await promise;
  }
  return { stores, cache, fetched, fetcher, skipWaiting, dispatch };
}
it("installs a complete version with reload requests and waits before activation", async () => {
  const h = harness();
  await h.dispatch("install");
  expect(h.skipWaiting).not.toHaveBeenCalled();
  expect(h.fetched.map((r) => r.cache)).toEqual(["reload", "reload"]);
  await h.dispatch("message", { data: { type: "ACTIVATE_UPDATE" } });
  expect(h.skipWaiting).toHaveBeenCalledOnce();
});
it("retains the previous assets and never deletes unrelated caches", async () => {
  const h = harness();
  for (const n of [
    "other-app",
    "ryadom-shell-ancient",
    "ryadom-shell-old",
    "ryadom-shell-previous",
    "ryadom-shell-new",
  ])
    h.cache(n);
  await h.dispatch("activate");
  expect([...h.stores.keys()]).toEqual([
    "other-app",
    "ryadom-shell-old",
    "ryadom-shell-previous",
    "ryadom-shell-new",
  ]);
  h.stores
    .get("ryadom-shell-old")!
    .set(
      "https://example.test/ryadom-app/assets/old.js",
      new Response("old code"),
    );
  const r = await h.dispatch("fetch", {
    request: {
      method: "GET",
      mode: "cors",
      url: "https://example.test/ryadom-app/assets/old.js",
    },
  });
  expect(await r.text()).toBe("old code");
  expect(h.fetcher).not.toHaveBeenCalled();
});
it("serves HTML from the same installed release even with a new deployment or no network", async () => {
  const h = harness();
  h.cache("ryadom-shell-new");
  h.stores
    .get("ryadom-shell-new")!
    .set("/ryadom-app/index.html", new Response("new shell"));
  const r = await h.dispatch("fetch", {
    request: {
      method: "GET",
      mode: "navigate",
      url: "https://example.test/ryadom-app/",
    },
  });
  expect(await r.text()).toBe("new shell");
  expect(h.fetcher).not.toHaveBeenCalled();
});
it("shows a retry page after storage eviction and network failure", async () => {
  const h = harness();
  const r = await h.dispatch("fetch", {
    request: {
      method: "GET",
      mode: "navigate",
      url: "https://example.test/ryadom-app/",
    },
  });
  expect(r.status).toBe(503);
  expect(await r.text()).toContain("Повторить");
});
it("never intercepts account API requests or writes", async () => {
  const h = harness();
  expect(
    await h.dispatch("fetch", {
      request: {
        method: "GET",
        url: "https://api.example.test/ryadom-app/data",
      },
    }),
  ).toBeUndefined();
  expect(
    await h.dispatch("fetch", {
      request: { method: "POST", url: "https://example.test/ryadom-app/data" },
    }),
  ).toBeUndefined();
  expect(h.fetcher).not.toHaveBeenCalled();
});

it("falls back to the network when the browser cache storage is unavailable", async () => {
  const h = harness();
  // Force storage failure after a successful install, as can happen after eviction.
  h.cache("ryadom-shell-new");
  h.stores.get("ryadom-shell-new")!.get = () => {
    throw Error("Cache unavailable");
  };
  h.fetcher.mockImplementation(async () => new Response("online shell"));
  const r = await h.dispatch("fetch", {
    request: {
      method: "GET",
      mode: "navigate",
      url: "https://example.test/ryadom-app/",
    },
  });
  expect(await r.text()).toBe("online shell");
});
