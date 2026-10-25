import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { blankPet } from "./domain";
import type { AuthSession } from "./backend";
import { Sharing } from "./Sharing";
import TrainingDateField from "./TrainingDateField";

const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const app = source("./App.tsx");
const sharing = source("./Sharing.tsx");
const css = source("./styles.css");

const session: AuthSession = {
  user: { id: "u", email: "owner@example.com" },
  accessToken: "test", refreshToken: "test", expiresAt: 9999999999999,
};

describe("Pet profile editor and sharing management refinements", () => {
  it("uses the same bounded native calendar as Training with the birth-date max", () => {
    const markup = renderToStaticMarkup(<TrainingDateField
      label="Дата рождения" name="birthday"
      defaultValue="2020-01-15" max="2026-10-25" />);
    expect(markup).toContain('class="training-date-wrap"');
    expect(markup).toContain('type="date"');
    expect(markup).toContain('max="2026-10-25"');
    expect(app).toContain('<TrainingDateField');
    expect(app).not.toContain('label="Дата рождения"\n              name="birthday"\n              type="date"');
    expect(css).toContain('.pet-editor-modal .training-date-wrap input[type="date"]');
    expect(css).toContain('position: absolute;');
    expect(css).toContain('opacity: 0;');
    expect(css).toContain('.pet-editor-modal .field > label');
    expect(css).toContain('font-size: var(--font-size-sm);');
  });

  it("places copy and new-code icons in the ID card, with accessible labels", () => {
    const pet = blankPet("Маша");
    pet.role = "owner";
    pet.shareCode = "RYD-2345678ABC";
    const markup = renderToStaticMarkup(<Sharing session={session} pet={pet} onChanged={async () => {}} />);
    const card = markup.split('sharing-id-card')[1]?.split('</section>')[0] ?? "";
    expect(card).toContain('sharing-id-row');
    expect(card).toContain('aria-label="Скопировать ID"');
    expect(card).toContain('aria-label="Сгенерировать новый ID"');
    expect(card).not.toContain('>Скопировать ID<');
    expect(card).not.toContain('>Сгенерировать новый ID<');
    expect(css).toContain('.pet-sharing-modal .sharing-id-actions .icon-button');
  });

  it("shows all non-owner members in one card, with inline revoke controls", () => {
    const sharingSection = sharing.split('<SectionHeader title="Пользователи с доступом" />')[1]
      ?.split("</>")[0] ?? "";
    expect(sharingSection).toContain('<Card className="sharing-members-list">');
    expect(sharing).toContain('const editorMembers = details.members.filter((member) => member.role === "editor")');
    expect(sharingSection).toContain("editorMembers.map((member) => (");
    expect(sharingSection).toContain('className="sharing-revoke"');
    expect(sharingSection).not.toContain('className="sharing-member-card"');
    expect(sharingSection).not.toContain('"Совместный доступ"');
    expect(sharingSection).not.toContain('action: "delete"');
    expect(css).toContain('.pet-sharing-modal .sharing-member-row');
  });

  it("reserves pet deletion for the owner's management page below backup", () => {
    const profile = app.split('<section className="pet-profile-screen">')[1]
      ?.split('</section>\n          )}')[0] ?? "";
    expect(profile).toContain('className="pet-profile-delete"');
    expect(profile.indexOf('Резервные копии и восстановление'))
      .toBeLessThan(profile.indexOf('className="pet-profile-delete"'));
    expect(profile).toContain('pet.role === "owner" && (');
    expect(app).toContain('case "deletePet":');
    expect(app).toContain('await petAccess(session, "delete", { target: pet.id })');
    expect(app).toContain('await refreshNow()');
    expect(sharing).not.toContain('action: "delete"');
  });

  it("has no invite-by-email form in the sharing dialog", () => {
    expect(sharing).not.toContain("Пригласить по email");
    expect(sharing).not.toContain("Отправить приглашение");
    expect(sharing).not.toContain("sendPetInvitation");
    expect(css).not.toContain('.pet-sharing-modal .field:has(input[name="email"])');
  });
});
