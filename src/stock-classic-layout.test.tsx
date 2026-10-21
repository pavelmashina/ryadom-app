import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import Stock from "./Stock";
import { blankPet } from "./domain";
import type { AuthSession } from "./backend";

const source = readFileSync(new URL("./Stock.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./stock.css", import.meta.url), "utf8");
const session = {
  user: { id: "example", email: "example@example.com" },
  accessToken: "", refreshToken: "", expiresAt: 0,
} as AuthSession;

describe("Restored stock screen composition", () => {
  it("keeps the simple classic shopping layout without redundant page labels", () => {
    const pet = blankPet("Мася");
    pet.shopping = [{id:"one",name:"Корм",quantity:"3 кг",done:false}];
    const html = renderToStaticMarkup(<Stock
      pet={pet} session={session}
      onShop={() => {}} onToggle={() => {}} />);
    expect(html).not.toContain("Питание и запасы");
    expect(html).not.toContain("Всё под рукой");
    expect(html).not.toContain("Остатки, расход и список покупок");
    expect(html).toContain("Купить");
    expect(html).toContain("Добавить покупку");
    expect(html).toContain("checkbox shopping");
    expect(html).not.toContain('<h1>Запасы</h1>');
    expect(source).not.toContain("<PageHeader");
    expect(html).toContain("Добавить запас");
  });

  it("renders main balance in the former pale-green info card above purchases", () => {
    const featuredStart = source.indexOf('<Card variant="info" className="stock-featured">');
    const buyList = source.indexOf('<SectionHeader title="Купить">');
    expect(featuredStart).toBeGreaterThan(0);
    expect(buyList).toBeGreaterThan(featuredStart);
    expect(source).toContain('className="stock-overview"');
    expect(source).toContain('<Badge><Package/>');
    expect(source).toContain('className="spread stock-scale"');
    expect(source).toContain('<Button fullWidth variant="primary" onClick={openAdd}>');
    expect(source).toContain('className="stock-shopping-list"');
    // Other stocked items still open their unchanged detail and operations.
    expect(source).toContain('onClick={()=>goDetail(item)}');
    expect(source).toContain('mutate("set_rule"');
    expect(source).toContain('mutate("create"');
    expect(source).toContain('mutate("archive"');
  });

  it("keeps one stock-add CTA and exposes a food settings gear with a direct switch", () => {
    expect(source).toContain('className="stock-gear"');
    expect(source).toContain('<Settings aria-hidden="true"/>');
    expect(source).toContain('aria-controls="stock-featured-settings"');
    expect(source).toContain('className="stock-gear-panel"');
    expect(source).toContain("Изменить расход");
    expect(source).toContain("Списать вручную");
    expect(source).toContain('role="switch"');
    expect(source).toContain('checked={Boolean(activeStockRule(featured))}');
    expect(source).toContain('onChange={e=>void toggleAuto(featured,e.target.checked)}');
    expect(source).not.toContain("><Plus/> Пополнить</Button>");
    expect(source).not.toContain('className="stock-add-item"');
    expect(source).toContain('checked={createTarget==="existing"}');
    expect(source).toContain('checked={createTarget==="new"}');
    expect(source).toContain('onSubmit={onAddExisting}');
    expect(source).toContain('onSubmit={onCreate}');
    expect(source).toContain('mutate("add"');
  });

  it("lets users edit a saved consumption rate even while auto-deduction is off", () => {
    expect(source).toContain("const savedRule=activeStockRule(item)??item.rules[0]");
    expect(source).toContain('if(enabled&&!savedRule){openRule(item);return;}');
    expect(source).toContain('await mutate("set_rule",');
    expect(source).toContain('Расход сохранится, но автоматическое списание останется выключенным.');
    expect(source).not.toContain('{ruleEnabled&&<>');
    expect(source).toContain('name="amount"');
  });

  it("restores the former colors/radii without altering the compact typography", () => {
    const info = css.split(".stock-screen .card.stock-featured,")[1]
      ?.split("}")[0] ?? "";
    expect(info).toContain("background: var(--color-surface-secondary)");
    expect(info).toContain("border-radius: var(--radius-lg)");
    expect(info).toContain("box-shadow: none");
    const secondary = css.split(".stock-card {")[1]?.split("}")[0] ?? "";
    expect(secondary).toContain("background: var(--color-surface)");
    expect(secondary).toContain("border-radius: var(--radius-lg)");
    for (const size of ["xl", "lg", "md", "sm", "xs"]) {
      expect(css).toContain("var(--font-size-" + size + ")");
    }
    expect([...css.matchAll(/font-size:\\s*(\\d+)px/g)]).toHaveLength(0);
    expect(css).toContain("font-family: var(--font-family-base)");
    expect(css).toContain(".stock-gear-panel");
    expect(css).toContain(".stock-switch:checked");
    expect(css).toContain(".stock-switch::after");
  });

  it("keeps exactly the agreed 12px heading and 16px section rhythm", () => {
    expect(css).toContain("--stock-heading-gap: var(--space-compact-4)");
    expect(css).toContain("--stock-section-gap: var(--space-compact-5)");
    const heading = css.split(".stock-screen .section-title {")[1]
      ?.split("}")[0] ?? "";
    expect(heading).toContain("margin: 0 0 var(--stock-heading-gap)");
    const featured = css.split(".stock-screen .card.stock-featured,")[1]
      ?.split("}")[0] ?? "";
    expect(featured).toContain("margin: 0 0 var(--stock-section-gap)");
    expect(css).toContain("margin: 0 0 var(--stock-section-gap)");
    expect(css).toContain(".stock-screen .shopping");
  });
});
