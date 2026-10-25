import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import AccountTrigger from "./AccountTrigger";

const src = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Account pending pet-access request bell", () => {
  it("keeps the original account trigger alone when there are no pending requests", () => {
    const html = renderToStaticMarkup(<AccountTrigger hasPendingRequests={false} onClick={() => {}} />);
    expect(html).toContain('aria-label="Аккаунт"');
    expect(html).toContain("account-trigger");
    expect(html).not.toContain("account-notification-bell");
    expect((html.match(/<button/g) || []).length).toBe(1);
    expect((html.match(/<svg/g) || []).length).toBe(1);
  });
  it("draws one decorative bell over the existing icon and announces requests to assistive tech", () => {
    const html = renderToStaticMarkup(<AccountTrigger hasPendingRequests onClick={() => {}} />);
    expect(html).toContain('aria-label="Аккаунт: есть запросы на присоединение к питомцу"');
    expect(html).toContain('class="account-notification-bell"');
    expect(html).toContain('aria-hidden="true"');
    expect((html.match(/<button/g) || []).length).toBe(1);
    expect((html.match(/<svg/g) || []).length).toBe(2);
  });
  it("uses the server-owned pending count, including requests for other owned pets", () => {
    const app = src("./App.tsx");
    expect(app).toContain('p.role === "owner" && (p.pendingRequests ?? 0) > 0');
    expect(app).toContain("hasPendingRequests={state.pets.some(");
    expect(app).not.toContain('className="request-dot"');
    expect(app).not.toContain('label="Есть запросы на доступ"');
    expect(app).toContain("onClick={openAccount}");
    expect(app).toContain("onRefresh");
  });
  it("positions a small noninteractive overlapping badge without moving the account icon", () => {
    const css = src("./styles.css");
    const host = css.split(".account-trigger {")[1]?.split("}")[0] ?? "";
    const bell = css.split(".account-trigger .account-notification-bell {")[1]?.split("}")[0] ?? "";
    const icon = css.split(".account-trigger .account-notification-bell svg {")[1]?.split("}")[0] ?? "";
    expect(host).toContain("position: relative");
    expect(host).toContain("overflow: visible");
    expect(bell).toContain("position: absolute");
    expect(bell).toContain("top: -4px");
    expect(bell).toContain("right: -4px");
    expect(bell).toContain("width: 17px");
    expect(bell).toContain("height: 17px");
    expect(bell).toContain("pointer-events: none");
    expect(icon).toContain("width: 11px");
    expect(icon).toContain("height: 11px");
  });
});
