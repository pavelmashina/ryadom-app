import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parsePushApiResponse } from "./push-response";

describe("Supabase push subscription responses", () => {
  it("accepts 201 Created with no body (Prefer: return=minimal)", async () => {
    const response = new Response(null, {
      status: 201,
      headers: { "content-length": "0" },
    });
    await expect(parsePushApiResponse(response)).resolves.toBeNull();
  });

  it.each([200, 201, 204, 205])(
    "does not parse the empty response body for HTTP %s", async (status) => {
      const response = new Response(null, { status });
      await expect(parsePushApiResponse(response)).resolves.toBeNull();
    },
  );

  it("parses JSON for a successful SELECT response", async () => {
    const response = new Response(JSON.stringify([{ id: "abc", endpoint: "https://push.example" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await expect(parsePushApiResponse(response)).resolves.toEqual([
      { id: "abc", endpoint: "https://push.example" },
    ]);
  });

  it("reports real HTTP errors without showing raw PostgREST body", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = new Response(JSON.stringify({
        code: "42501",
        message: "Sensitive database detail",
      }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
      await expect(parsePushApiResponse(response)).rejects.toThrow(
        "Не удалось выполнить запрос к серверу уведомлений (403)",
      );
      expect(spy).toHaveBeenCalledWith(
        "[push] Supabase request rejected", { status: 403, code: "42501" },
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps failed subscription attempts retryable with the existing endpoint", () => {
    const source = readFileSync(new URL("./PushSettings.tsx", import.meta.url), "utf8");
    expect(source).toContain("await saveSubscription(session, sub)");
    expect(source).not.toMatch(/if \(!current\) await sub\.unsubscribe/);
  });
});
