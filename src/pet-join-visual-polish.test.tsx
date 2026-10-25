import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { JoinPet } from "./Sharing";
import type { AuthSession } from "./backend";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const sharing = read("./Sharing.tsx");
const css = read("./styles.css");
const session = {
  user: { id: "00000000-0000-4000-8000-000000000001", email: "test@example.test" },
  accessToken: "access", refreshToken: "refresh", expiresAt: 99999999999,
} as AuthSession;

function declaration(selector: string): string {
  return css.split(selector + " {")[1]?.split("}")[0] ?? "";
}

describe("Add Existing Pet UI refinements", () => {
  it("keeps the normal lookup form and adds space before found pet", () => {
    const html = renderToStaticMarkup(<JoinPet session={session} onChanged={async () => {}} />);
    expect(html).toContain("Найти питомца");
    expect(html).toContain("ID питомца");
    expect(sharing).toContain('className="pet-join-result"');
    expect(declaration(".pet-join-modal > .card.pet-join-result"))
      .toContain("margin-top: var(--space-compact-5);");
  });

  it("removes the redundant add-pet confirmation sentence", () => {
    expect(sharing).not.toContain("Добавить питомца {found.name}?");
    expect(sharing).toContain('<h3>{found.name}</h3>');
    expect(sharing).toContain('label="Отправить запрос на добавление" variant="secondary"');
    expect(sharing).toContain('label="Отменить запрос" variant="destructive"');
  });

  it("outlines request and cancellation actions without a fill", () => {
    const request = declaration(".pet-join-modal .pet-join-result .form-actions .btn");
    const cancel = declaration(".pet-join-modal .pet-join-request .form-actions .btn");
    expect(request).toContain("border: 1px solid var(--color-primary);");
    expect(request).toContain("background: transparent;");
    expect(request).toContain("color: var(--color-primary);");
    expect(cancel).toContain("border: 1px solid var(--color-danger);");
    expect(cancel).toContain("background: transparent;");
    expect(cancel).toContain("color: var(--color-danger);");
  });
});
