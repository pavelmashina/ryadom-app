import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { blankPet } from "./domain";
import { inviteLink, invitationMailto, joinCodeFromUrl } from "./share-invitation";
import { completeShoppingItem, restoreShoppingItem } from "./shopping-checkout";
import { JoinPet, Sharing } from "./Sharing";
import Stock from "./Stock";
import type { AuthSession } from "./backend";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("R3: email invitation links", () => {
  const code = "RYD-2345678ABC";
  const url = "https://pavelmashina.github.io/ryadom-app/";
  it("builds an origin-constrained deep link preserving the PWA subfolder", () => {
    expect(inviteLink("https://pavelmashina.github.io", "/ryadom-app/", code))
      .toBe(url + "?join=" + code);
    expect(joinCodeFromUrl("?join=ryd-2345678abc")).toBe(code);
    expect(joinCodeFromUrl("?join=https%3A%2F%2Fevil.example")).toBeNull();
    expect(() => inviteLink("https://example.com", "https://evil.example/", code)).toThrow();
    expect(() => inviteLink("https://example.com", "/ryadom-app/", "evil")).toThrow();
  });
  it("formats mailto without automatic approval or leaking email to arbitrary endpoint", () => {
    const mailto = invitationMailto(" friend@example.com ", "Бублик", url + "?join=" + code);
    expect(mailto).toContain("mailto:friend%40example.com");
    expect(decodeURIComponent(mailto)).toContain("После подтверждения мной");
    expect(decodeURIComponent(mailto)).toContain("?join=" + code);
    expect(() => invitationMailto("not-an-email", "Бублик", url)).toThrow();
  });
  it("renders a clear confirmation-based flow and prefilled access code", () => {
    const session: AuthSession = {
      user: { id: "u", email: "owner@example.com" },
      accessToken: "test",
      refreshToken: "test",
      expiresAt: 9999999999999,
    };
    const pet = blankPet("Бублик");
    pet.role = "owner";
    pet.shareCode = code;
    const owner = renderToStaticMarkup(
      <Sharing session={session} pet={pet} onChanged={async () => {}} />,
    );
    const guest = renderToStaticMarkup(
      <JoinPet session={session} onChanged={async () => {}} initialCode={code} />,
    );
    expect(owner).toContain("Пригласить по email");
    expect(owner).toContain("не автоматически");
    expect(guest).toContain(code);
    expect(source("./App.tsx")).toContain('setOverlay({ kind: "join" })');
    expect(source("./App.tsx")).toContain('initialCode={joinCode}');
  });
});

describe("R3: purchase-to-stock checkout", () => {
  const initial = () => {
    const pet = blankPet("Бублик");
    pet.stock = 2;
    pet.shopping = [
      { id: "food", name: "Корм", quantity: "3 кг", done: false },
      { id: "toy", name: "Игрушка", quantity: "1", done: false },
    ];
    return pet;
  };
  it("marks bought food and increases stock in a single immutable transaction", () => {
    const pet = initial();
    const updated = completeShoppingItem(pet, "food", 3, "2026-10-16");
    expect(updated.stock).toBe(5);
    expect(updated.stockDate).toBe("2026-10-16");
    expect(updated.shopping[0].done).toBe(true);
    expect(updated.shopping[0].stockCreditedKg).toBe(3);
    expect(updated.shopping[1].done).toBe(false);
    expect(pet.stock).toBe(2);
    expect(pet.shopping[0].done).toBe(false);
    expect(() => completeShoppingItem(updated, "food", 3, "2026-10-16"))
      .toThrow(/Повторное пополнение/);
  });
  it("supports non-food purchases with no stock adjustment", () => {
    const updated = completeShoppingItem(initial(), "toy", 0, "2026-10-16");
    expect(updated.stock).toBe(2);
    expect(updated.stockDate).toBe("");
    expect(updated.shopping[1].done).toBe(true);
  });
  it("does not subtract already purchased food when unchecking the item", () => {
    const pet = completeShoppingItem(initial(), "food", 1.5, "2026-10-16");
    const restored = restoreShoppingItem(pet, "food");
    expect(restored.stock).toBe(3.5);
    expect(restored.shopping[0].done).toBe(false);
    expect(() => completeShoppingItem(restored, "food", 1.5, "2026-10-16")).toThrow(/уже внесён/);
    expect(completeShoppingItem(restored, "food", 0, "2026-10-16").stock).toBe(3.5);
  });
  it.each([-1, NaN, Infinity, 101, 1.2345])(
    "rejects invalid food amounts %s", (amount) => {
      expect(() => completeShoppingItem(initial(), "food", amount, "2026-10-16")).toThrow();
    },
  );
  it("refuses stock overflow and unknown item IDs", () => {
    const pet = initial();
    pet.stock = 999;
    expect(() => completeShoppingItem(pet, "food", 3, "2026-10-16")).toThrow();
    expect(() => completeShoppingItem(pet, "missing", 0, "2026-10-16")).toThrow();
  });
  it("renders shopping list and explains explicit stock confirmation", () => {
    const html = renderToStaticMarkup(<Stock
      pet={initial()} onEdit={() => {}} onAdd={() => {}}
      onShop={() => {}} onToggle={() => {}} />);
    expect(html).toContain("вы можете сразу внести купленный корм");
    const app = source("./App.tsx");
    expect(app).toContain('kind: "finishShopping"');
    expect(app).toContain("completeShoppingItem(p, item.id, amount, today())");
    expect(app).toContain("restoreShoppingItem(p, itemId)");
  });
});
