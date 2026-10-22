import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import Stock from "./Stock";
import { blankPet } from "./domain";
import type { AuthSession } from "./backend";

const source=readFileSync(new URL("./Stock.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("./stock.css",import.meta.url),"utf8");
const session:AuthSession={
 user:{id:"test",email:"test@example.com"},
 accessToken:"",refreshToken:"",expiresAt:0,
};

describe("Unified stock and shopping overview",()=>{
 it("renders one overview heading, one common plus and the shopping checklist",()=>{
  const pet=blankPet("Мася");
  pet.shopping=[{id:"food",name:"Корм",quantity:"3 кг",done:false}];
  const html=renderToStaticMarkup(<Stock pet={pet} session={session}
   onShop={()=>{}} onToggle={()=>{}}/>);
  expect(html).toContain("Запасы");
  expect(html).toContain("Купить");
  expect(html).toContain("Корм");
  expect(html).toContain('aria-label="Добавить запас или покупку"');
  expect(html).toContain('class="card card-info stock-collection"');
  expect(html).not.toContain("Фактический остаток");
  expect(html).not.toContain("Фактические запасы");
  expect(html).not.toContain("Питание и запасы");
  expect(html).not.toContain("Всё под рукой");
 });
 it("uses the same row and same parent panel for every stock item",()=>{
  expect(source).toContain('<Card variant="info" className="stock-collection">');
  expect(source).toContain("visibleItems.map(item=>{");
  expect(source).toContain('className={"stock-item stock-"+status}');
  expect(source).toContain('className="stock-item-balance"');
  expect(source).toContain('className="stock-item-category"');
  expect(source).toContain('className="stock-item-footer"');
  expect(source).toContain('onClick={()=>goDetail(item)}');
  expect(source).toContain('onClick={e=>showStockMenu(item,e.currentTarget)}');
  expect(source).not.toContain("featured");
  expect(source).not.toContain("groups.map");
  expect(source).not.toContain("Фактический остаток");
 });
 it("has one visible plus that turns into the undimmed close control when opened",()=>{
  expect(source.match(/<Plus aria-hidden="true"\/>/g)).toHaveLength(2);
  expect(source.match(/className="stock-add-trigger"/g)).toHaveLength(1);
  expect(source).toContain('className="stock-add-trigger stock-add-trigger-overlay"');
  expect(source).toContain('aria-label="Закрыть меню добавления"');
  expect(source).toContain('style={addTriggerRect}');
  expect(source).toContain('ref={addCloseTrigger}');
  expect(source).toContain('onClick={()=>setGearOpen(false)}');
  expect(source).toContain('onClick={e=>showStockMenu(null,e.currentTarget)}');
  expect(source).toContain('setGearOpen(false);openAdd();');
  expect(source).toContain('setGearOpen(false);onShop();');
  expect(source).toContain('>Добавить запас</button>');
  expect(source).toContain('>Добавить покупку</button>');
  expect(source).not.toContain('><Plus/> Добавить запас</Button>');
  expect(source).not.toContain('><Plus/> Добавить покупку</Button>');
  expect(source).toContain('setCreateTarget(mode==="detail"&&current?"existing":"new");');
  expect(source).toContain('onSubmit={onAddExisting}');
  expect(source).toContain('onSubmit={onCreate}');
 });
 it("uses the same settings action for all stocks, with no loss of operations",()=>{
  expect(source).toContain("const settingsItem=visibleItems.find((i)=>i.id===settingsItemId);");
  expect(source).toContain("settingsItem ? <>");
  expect(source).toContain('checked={Boolean(activeStockRule(settingsItem))}');
  expect(source).toContain('toggleAuto(settingsItem,e.target.checked)');
  expect(source).toContain('openRule(settingsItem)');
  expect(source).toContain('openOperation(settingsItem,"manual_use","list")');
  expect(source).toContain('goDetail(settingsItem)');
  for(const name of ['mutate("create"','mutate("add"','mutate("edit"','mutate(operation','mutate("set_rule"','mutate("archive"']){
   expect(source).toContain(name);
  }
 });
 it("keeps the modal behavior: overlay, outside-tap, scroll lock and focus trap",()=>{
  expect(source).toContain('createPortal(');
  expect(source).toContain('className="stock-settings-backdrop"');
  expect(source).toContain('onPointerDown={e=>e.stopPropagation()}');
  expect(source).toContain('aria-modal="true"');
  expect(source).toContain('document.body.style.position="fixed"');
  expect(source).toContain('document.documentElement.style.overflow="hidden"');
  expect(source).toContain('if(e.key==="Escape")');
  expect(source).toContain('if(e.key==="Tab")');
  const menu=css.split(".stock-gear-panel {")[1]?.split("}")[0]??"";
  expect(menu).toContain("position: fixed");
  expect(menu).toContain("font-family: var(--font-family-base)");
 });
 it("dismisses after release so taps cannot activate underlying buttons",()=>{
  expect(source).toContain('if(gearOpen&&settingsItemId===(item?.id??null))');
  expect(source).toContain('onPointerDown={e=>e.stopPropagation()}');
  expect(source).toContain('onPointerUp={e=>e.stopPropagation()}');
   expect(source).toContain('onClick={e=>{e.preventDefault();e.stopPropagation();setGearOpen(false);}}');
   expect(source).not.toContain('onPointerDown={e=>{e.preventDefault();setGearOpen(false);}}');
  expect(source).toContain('onClick={()=>setGearOpen(false)}');
  const layer=css.split(".stock-settings-layer {")[1]?.split("}")[0]??"";
  expect(layer).toContain("z-index: 30");
  const overlayButton=css.split(".stock-settings-layer .stock-add-trigger-overlay {")[1]?.split("}")[0]??"";
  expect(overlayButton).toContain("position: fixed");
  expect(overlayButton).toContain("z-index: 2");
  expect(overlayButton).toContain("opacity: 1");
  expect(css).toContain("@keyframes stock-add-becomes-close");
  expect(css).toContain("transform: rotate(45deg)");
 });

 it("edits the consumption rate without a second auto-deduction toggle or overflowing dates",()=>{
  const editor=source.split('{mode==="rule"&&<>')[1]?.split('   </>}')[0]??"";
  expect(editor).toContain('className="stock-rule-heading">Изменить расход');
  expect(editor).toContain('className="stock-form stock-rule-form"');
  expect(editor).toContain('className="stock-rule-date-wrap"');
   expect(editor).toContain('className="stock-rule-date" type="date"');
  expect(editor).toContain('allowedFrequencies={["daily","weekly","monthly"]}');
  expect(editor).not.toContain('className="stock-switch"');
  expect(editor).not.toContain('role="switch"');
  expect(source).toContain('openRule(item,true)');
  expect(source).toContain('setRuleEnabled(enableOnSave||Boolean(activeStockRule(item)))');
  expect(source).toContain('enabled:ruleEnabled');
  const rule=css.split(".stock-screen .stock-rule-form {")[1]?.split("}")[0]??"";
  expect(rule).toContain("max-width: 100%");
  expect(rule).toContain("min-width: 0");
  const dates=css.split('.stock-screen .stock-rule-form input[type="date"] {')[1]?.split("}")[0]??"";
  expect(dates).toContain("width: 100%");
  expect(dates).toContain("min-inline-size: 0");
  expect(dates).toContain("overflow: hidden");
   expect(css).toContain(".stock-screen .stock-rule-form .stock-rule-date-wrap {");
  expect(css).toContain("@media (max-width: 420px)");
  for(const token of ["--font-size-xs","--font-size-sm","--font-size-md","--font-size-lg"]){
   expect(css).toContain("var("+token+")");
  }
 });

 it("unifies back arrows and removes the redundant stock controls",()=>{
  expect(source).toContain('className="stock-back"');
  expect(source).toContain('<ArrowLeft aria-hidden="true"/>');
  expect(source).not.toContain('<ArrowLeft/> Назад');
  expect(css).toContain(".stock-screen .stock-back svg {");
  expect(css).toContain("width: var(--icon-size-lg)");
  const detail=source.split('{mode==="detail"&&<>')[1]?.split('    </>}')[0]??"";
  expect(detail).not.toContain('<SectionHeader title="Автоматическое списание"/>');
  expect(detail).toContain('onClick={()=>openRule(current)}');
  const operation=source.split('{mode==="operation"&&<>')[1]?.split('    </>}')[0]??"";
  expect(operation).toContain('className="stock-form stock-operation-form"');
  expect(operation).toContain('operation!=="manual_use"&&<Field label="Комментарий">');
 });
 it("follows the previous palette, compact typography and 12/16px spacing",()=>{
  const panel=css.split(".stock-screen .card.stock-collection {")[1]?.split("}")[0]??"";
  expect(panel).toContain("background: var(--color-surface-secondary)");
  expect(panel).toContain("border-radius: var(--radius-lg)");
  const rows=css.split(".stock-item {")[1]?.split("}")[0]??"";
  expect(rows).toContain("padding: var(--space-compact-4)");
  expect(css).toContain(".stock-item + .stock-item");
  expect(css).toContain("--stock-heading-gap: var(--space-compact-4)");
  expect(css).toContain("--stock-section-gap: var(--space-compact-5)");
  for(const size of ["xl","lg","md","sm","xs"])expect(css).toContain("var(--font-size-"+size+")");
  expect(css).toContain("font-family: var(--font-family-base)");
 });
});
