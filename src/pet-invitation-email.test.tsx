import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Sharing } from "./Sharing";
import { blankPet } from "./domain";
import type { AuthSession } from "./backend";
import { sendPetInvitation } from "./invitation-email";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const session: AuthSession = {
  user: { id: "u", email: "owner@example.test" },
  accessToken: "user-jwt",
  refreshToken: "test", expiresAt: 9999999999999,
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Standardized pet invitation delivery", () => {
  it("sends to the authenticated server endpoint, not mailto:", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://pets.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetcher);
    await sendPetInvitation(session, "12345678-1234-1234-1234-123456789abc", " friend@example.test ");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pets.example.test/functions/v1/pet-invitation-email");
    expect(options.headers).toMatchObject({
      Authorization: "Bearer user-jwt",
      apikey: "sb_publishable_test",
    });
    expect(JSON.parse(String(options.body))).toEqual({
      target: "12345678-1234-1234-1234-123456789abc",
      email: "friend@example.test",
    });
  });

  it("does not claim delivery for invalid emails, provider failures, or incomplete responses", async () => {
    await expect(sendPetInvitation(session, "p", "wrong-email")).rejects.toThrow("корректный адрес");
    vi.stubEnv("VITE_SUPABASE_URL", "https://pets.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Отправка приглашений ещё не настроена.",
    }), { status: 503 })));
    await expect(sendPetInvitation(session, "p", "valid@example.test")).rejects.toThrow("не настроена");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(sendPetInvitation(session, "p", "valid@example.test")).rejects.toThrow("не подтвердил");
  });

  it("uses a single standard template, not user-edited subject and email body", () => {
    const edge = read("../supabase/functions/pet-invitation-email/index.ts");
    const sql = read("../supabase/migrations/20261025104004_pet_email_invitation_dispatch_guard.sql");
    expect(edge).toContain("function invitationContents(details: PreparedInvitation)");
    expect(edge).toContain("Запросить доступ");
    expect(edge).toContain("Отправитель:");
    expect(edge).toContain("reply_to: details.sender_email");
    expect(edge).toContain('to: [details.recipient_email]');
    expect(edge).toContain('method: "POST", headers');
    expect(edge).toContain('/auth/v1/user');
    expect(edge).toContain('/rest/v1/rpc/prepare_pet_email_invitation');
    expect(sql).toContain("pet_private.member_role(pid) is distinct from 'owner'");
    expect(sql).toContain("30 then");
    expect(sql).toContain("interval '2 minutes'");
  });

  it("renders an actual submit action labelled Отправить приглашение", () => {
    const pet = blankPet("Мася");
    pet.role = "owner";
    const owner = renderToStaticMarkup(<Sharing session={session} pet={pet}
      onChanged={async () => {}} />);
    expect(owner).toContain("Отправить приглашение");
    expect(owner).not.toContain("Подготовить приглашение");
    expect(owner).not.toContain("Открыть письмо");
    expect(owner).not.toContain("Скопировать ссылку");
  });

  it("changes only details-form input typography, preserving its date value", () => {
    const css = read("./styles.css");
    expect(css).toContain(".pet-editor-modal .field > label {\n  font-size: var(--font-size-md)");
    expect(css).toContain('.pet-editor-modal .field :is(input:not([type="date"]), select, textarea)');
    expect(css).toContain('font-size: var(--font-size-sm);');
    expect(css).toContain('.pet-editor-modal .training-date-value');
  });
});
