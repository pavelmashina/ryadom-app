import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { blankPet } from "./domain";
import { JoinPet, Sharing } from "./Sharing";
import { pendingAccessRequests, type OutgoingRequest } from "./sharing-api";
import type { AuthSession } from "./backend";

const file = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const sharing = file("./Sharing.tsx");
const css = file("./styles.css");
const app = file("./App.tsx");
const session: AuthSession = {
  user: { id: "owner", email: "owner@example.test" },
  accessToken: "access", refreshToken: "refresh", expiresAt: 9999999999999,
};

describe("Code-only sharing and unanswered access requests", () => {
  it("removes invitation by email without affecting copy/rotate ID and moderation", () => {
    const pet = blankPet("Мася");
    pet.role = "owner";
    pet.shareCode = "RYD-2345678ABC";
    const html = renderToStaticMarkup(<Sharing session={session} pet={pet} onChanged={async () => {}} />);
    expect(html).not.toContain("Пригласить по email");
    expect(html).not.toContain("Email получателя");
    expect(html).not.toContain("Отправить приглашение");
    expect(html).toContain('aria-label="Скопировать ID"');
    expect(html).toContain('aria-label="Сгенерировать новый ID"');
    expect(html).toContain("Запросы на доступ");
    expect(html).toContain("Пользователи с доступом");
    expect(sharing).not.toContain("sendPetInvitation");
    expect(sharing).not.toContain("invitationMailto");
  });

  it("filters all resolved and cancelled requests while retaining only pending", () => {
    const samples: OutgoingRequest[] = [
      { id: "a", name: "А", status: "approved", created_at: "" },
      { id: "p1", name: "Б", status: "pending", created_at: "" },
      { id: "r", name: "В", status: "rejected", created_at: "" },
      { id: "c", name: "Г", status: "cancelled", created_at: "" },
      { id: "p2", name: "Д", status: "pending", created_at: "" },
    ];
    expect(pendingAccessRequests(samples).map(r => r.id)).toEqual(["p1", "p2"]);
    expect(pendingAccessRequests(samples.filter(r => r.status !== "pending"))).toEqual([]);
    expect(sharing).toContain("setRequests(pendingAccessRequests(next));");
    expect(sharing).toContain('next.filter(r => r.status === "approved")');
    expect(sharing).toContain("onChanged()");
  });

  it("shows the requests section only if pending requests exist", () => {
    const html = renderToStaticMarkup(<JoinPet session={session} onChanged={async () => {}} />);
    expect(html).not.toContain("Ваши запросы");
    expect(sharing).toContain('!!requests.length && <SectionHeader title="Ваши запросы" />');
    expect(sharing).toContain("requests.map(request => (");
    expect(sharing).toContain("Ожидает подтверждения");
    expect(sharing).not.toContain("Доступ разрешён</p>");
    expect(sharing).not.toContain("Запрос отклонён</p>");
    expect(css).toContain(".pet-join-modal > .section-title h2");
    expect(css).toContain(".pet-join-modal > .card.pet-join-request");
    expect(css).toContain(".pet-join-modal .pet-join-request .btn");
  });

  it("reduces account pet names exactly one size level", () => {
    const selector = css.split(".app main > .account-pets-section .account-pet-row strong {")[1]?.split("}")[0] ?? "";
    expect(selector).toContain("font-size: var(--font-size-md);");
    expect(selector).not.toContain("var(--font-size-lg)");
    expect(app).toContain('className="account-pet-row"');
  });

  it("decommissions server-side email sending and its database grant", () => {
    const edge = file("../supabase/functions/pet-invitation-email/index.ts");
    const migration = file("../supabase/migrations/20261025110647_remove_pet_email_invitations.sql");
    expect(edge).toContain("status: 410");
    expect(edge).not.toContain("api.resend.com");
    expect(edge).not.toContain("RESEND_API_KEY");
    expect(migration).toContain("drop function if exists public.prepare_pet_email_invitation");
    expect(migration).toContain("drop function if exists pet_private.prepare_pet_email_invitation");
    expect(migration).toContain("drop table if exists pet_private.pet_email_invitation_attempts");
  });
});
