import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const app = read("./App.tsx");
const sharing = read("./Sharing.tsx");
const api = read("./sharing-api.ts");
const css = read("./styles.css");
const sql = read("../supabase/migrations/20261025100402_pet_members_summary_for_shared_profiles.sql");

describe("Pet account polish and secured membership summary", () => {
  it("renders plain red logout and a larger name only within Account's pet list", () => {
    const logout = css.split(".account-logout.btn,")[1]?.split("}")[0] ?? "";
    expect(logout).toContain("background: transparent;");
    expect(logout).toContain("border: 0;");
    expect(app).toContain('className="account-logout"');
    expect(css).toContain(".app main > .account-pets-section .account-pet-row strong");
    expect(css).toContain("font-size: var(--font-size-lg)");
  });
  it("keeps add-pet buttons close and uses consistent modal typography", () => {
    expect(css).toContain(".pet-add-choices { gap: var(--space-compact-2); }");
    expect(css).toContain("dialog:has(.standard-pet-modal) .modal-content");
    for (const modal of ["pet-editor-modal", "pet-document-modal", "pet-backup-modal", "pet-sharing-modal"])
      expect(app).toContain(modal);
    expect(css).toContain('.standard-pet-modal .field input[type="date"]');
    expect(css).toContain("max-width: 100%");
  });
  it("looks up a typed ID before offering a request and handles unknown IDs", () => {
    const join = sharing.split("export function JoinPet(")[1]?.split("export function PetMembersSummary(")[0] ?? "";
    expect(join).not.toContain("Введите ID, который вам передал владелец");
    expect(join).not.toContain("Обновить список питомцев");
    expect(join).toContain('"lookup", { code: value }');
    expect(join).toContain("setNotFound(true)");
    expect(join).toContain("Попробуйте другой код");
    expect(join).toContain('found.status === "pending"');
    expect(join).toContain('label="Отправить запрос на добавление"');
    expect(join).toContain("setInterval(read, 5000)");
    expect(join).toContain("onChanged()");
  });
  it("shows email and role for members and reserves management for the owner", () => {
    expect(app).toContain("<PetMembersSummary session={session} pet={pet} />");
    expect(app).toContain('pet.role === "owner" ? (');
    expect(sharing).toContain('className="pet-member-row"');
    expect(sharing).toContain('member.email');
    expect(sharing).toContain('"Владелец" : "Совместный доступ"');
    expect(api).toContain('"pet_members_summary"');
    expect(sql).toContain("pet_private.member_role(pid) is null");
    expect(sql).toContain("m.status = 'active'");
    expect(sql).toContain("p.deleted_at is null");
    expect(sql).toContain("revoke all on function public.pet_members_summary(uuid) from public, anon");
    expect(sql).toContain("grant execute on function public.pet_members_summary(uuid) to authenticated");
  });
  it("removes redundant sharing instructions", () => {
    expect(sharing).not.toContain("Отправьте этот ID человеку");
    expect(sharing).not.toContain("Сформируйте письмо со ссылкой");
  });
});
