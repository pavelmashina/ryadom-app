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
    // Stock data loads asynchronously, so SSR shows the checklist first.
    expect(source).toContain("<Plus/> Добавить запас");
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
    expect(source).toContain('aria-controls={gearOpen?"stock-featured-settings":undefined}');
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

  it("opens a true floating, keyboard-dismissible gear menu without growing the food card", () => {
    expect(source).toContain('import { createPortal } from "react-dom"');
    expect(source).toContain('createPortal(');
    expect(source).toContain('document.body)');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('ref={gearTrigger}');
    expect(source).toContain('ref={gearPopover}');
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain('e.key==="Escape"');
    expect(source).toContain('pointerdown",dismissOutside');
    expect(source).toContain('window.addEventListener("resize",reposition)');
    expect(source).toContain('document.addEventListener("scroll",reposition,true)');
    const menuStyle = css.split(".stock-gear-panel {")[1]?.split("}")[0] ?? "";
    expect(menuStyle).toContain("position: fixed");
    expect(menuStyle).toContain("z-index: 1");
    const layer=css.split(".stock-settings-layer {")[1]?.split("}")[0] ?? "";
    expect(layer).toContain("z-index: 30");
    expect(layer).toContain("touch-action: none");
    const backdrop=css.split(".stock-settings-backdrop {")[1]?.split("}")[0] ?? "";
    expect(backdrop).toContain("background: color-mix(");
    expect(menuStyle).toContain("overflow-y: auto");
    expect(menuStyle).toContain("font-family: var(--font-family-base)");
  });

  it("dims and freezes the background while opening evenly aligned settings", () => {
    expect(source).toContain('className="stock-settings-layer"');
    expect(source).toContain('className="stock-settings-backdrop"');
    expect(source).toContain('onClick={()=>setGearOpen(false)}');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('document.body.style.position="fixed"');
    expect(source).toContain('document.documentElement.style.overflow="hidden"');
    expect(source).toContain('document.body.style.position=oldBody.position');
    expect(source).toContain('window.scrollTo({top:scrollY,behavior:"instant"})');
    expect(source).toContain('if(e.key==="Tab")');
    const actions=css.split(".stock-gear-panel > button,")[1]?.split("}")[0] ?? "";
    expect(actions).toContain(".stock-gear-panel > .stock-switch-row");
    expect(actions).toContain("align-items: center");
    expect(actions).toContain("padding: var(--space-compact-3) var(--space-compact-4)");
    expect(actions).toContain("text-align: left");
  });

  it("returns to the correct screen for each operation and cleans push deep-links", () => {
    expect(source).toContain("stockBackDestination(mode,editorReturn)");
    expect(source).toContain('openOperation(featured,"manual_use","list")');
    expect(source).toContain('openOperation(current,"manual_use","detail")');
    expect(source).toContain('openOperation(current,"correction","detail")');
    expect(source).toContain('openEditor("edit",current,"detail")');
    expect(source).toContain('if(updated)leaveEditor();');
    expect(source).toContain('onInitialItemHandled?.()');
    expect(source).toContain('activePetId.current!==targetPetId');
    const app=readFileSync(new URL("./App.tsx",import.meta.url),"utf8");
    expect(app).toContain('onInitialItemHandled={() => setStockTarget(undefined)}');
  });

  it("returns to the existing stock list after saving a new item", () => {
    const createFn=source.split("async function onCreate(")[1]?.split("async function onEdit(")[0] ?? "";
    expect(createFn).toContain('mutate("create"');
    expect(createFn).toContain("if(updated)closeDetails();");
    expect(createFn).not.toContain('goDetail(item)');
    expect(createFn).not.toContain('openRule(item)');
    expect(source).not.toContain('name="auto"');
  });

  it("shows usage details only in settings, not redundant enabled/disabled labels on cards", () => {
    const stockList=source.split('mode==="list"&&<>')[1]?.split('mode==="create"&&')[0] ?? "";
    expect(stockList).not.toContain("Автоматическое списание не включено.");
    expect(stockList).not.toContain("Автосписание выключено");
    expect(stockList).toContain("stockForecast(featured,today())");
    expect(stockList).toContain('className="stock-gear-panel"');
  });

  it("lets users edit a saved consumption rate even while auto-deduction is off", () => {
    expect(source).toContain("const savedRule=activeStockRule(item)??item.rules[0]");
    expect(source).toContain('if(enabled&&!savedRule){setGearOpen(false);openRule(item);return;}');
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
