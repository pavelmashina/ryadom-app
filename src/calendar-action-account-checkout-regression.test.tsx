import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import TrainingHistory from "./TrainingHistory";
import Training from "./Training";
import Stock from "./Stock";
import { blankPet, today } from "./domain";
import type { AuthSession } from "./backend";
const src=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const auth={user:{id:"test",email:"test@example.test"},accessToken:"token",refreshToken:"refresh",expiresAt:999999999999} as AuthSession;

describe("Training header and calendar add",()=>{
 it("uses the Day heading font and aligns the small add action beside calendar heading",()=>{
  const html=renderToStaticMarkup(<TrainingHistory
    sessions={[]} commands={[]} onOpen={()=>{}} onEdit={()=>{}} onAdd={()=>{}} />);
  expect(html).toContain('<h2>Календарь</h2>');
  expect(html).toContain('training-calendar-add');
  expect(html).toContain('aria-label="Добавить или запланировать тренировку"');
  const css=src("./training.css");
  const tab=css.split("/* Tabs occupy the same top baseline as")[1]??"";
  expect(tab).toContain("font-family: var(--font-family-base)");
  expect(tab).toContain("font-size: var(--font-size-lg)");
  expect(tab).toContain("font-weight: var(--font-weight-semibold)");
  expect(tab).toContain("padding-top:var(--space-compact-3)");
  expect(tab).toContain("width: var(--icon-size-lg)");
  expect(tab).toContain("height: var(--icon-size-lg)");
 });
 it("keeps floating plus only on Commands; Training has header add",()=>{
  const html=renderToStaticMarkup(<Training
    session={auth} pet={blankPet("Питомец")} onSave={async()=>{}} canEdit />);
  expect(html).toContain('training-calendar-add');
  expect(html).not.toContain('training-fab');
  const training=src("./Training.tsx");
  expect(training).toContain('activeTab === "commands" && <Button');
  expect(training).toContain('onAdd={() => setView({kind:"actions"})}');
 });
});

describe("Account density and floating pet selectors",()=>{
 it("keeps smaller, out-of-flow dropdowns and compact security fields",()=>{
  const css=src("./styles.css"),account=src("./Account.tsx");
  expect(css).toContain(".notification-pet-filter[open] {z-index:20;}");
  const pop=css.split(".account-content .notification-pet-filter-options {")[1]?.split("}")[0]??"";
  expect(pop).toContain("position:absolute");
  expect(pop).toContain("z-index:25");
  const pick=css.split(".account-content .notification-pet-filter summary {")[1]?.split("}")[0]??"";
  expect(pick).toContain("height: 30px");
  expect(css).toContain("width: min(100%, 180px)");
  expect(css).toContain("min-height: 32px");
  expect(account).toContain('className="account-credentials-form"');
  const form=src("./components.tsx");
  expect(form).toContain("className?: string");
  expect(form).toContain('<form onSubmit={submit} aria-busy={busy} className={className}>');
 });
});

describe("Three purchase completion modes",()=>{
 it("lets users mark without inventory, add a new stock, or credit an existing one",()=>{
  const stock=src("./Stock.tsx");
  for(const label of ["Только отметить купленным","Пополнить существующий запас","Добавить как новый запас"])
    expect(stock).toContain(label);
  expect(stock).toContain("checkoutMode!==\"only\"");
  expect(stock).toContain('onChange={()=>s.done?onToggle(s.id):openCheckout(s)}');
  expect(stock).toContain('await onPurchaseDone(checkoutPurchase.id)');
  expect(stock).toContain('"checkout_stock_purchase"');
  expect(stock).toContain('purchase.name.trim().toLocaleLowerCase("ru-RU")');
  const app=src("./App.tsx");
  expect(app).toContain('onPurchaseDone={async itemId => {');
  expect(app).toContain("completeShoppingItem(p,itemId,0,today())");
 });
 it("persists inventory with a replay-safe server transaction",()=>{
  const migration=src("../supabase/migrations/20261028183500_shopping_checkout_stock_options.sql");
  expect(migration).toContain("pg_advisory_xact_lock");
  expect(migration).toContain("external_key=ref");
  expect(migration).toContain("p_mode='existing'");
  expect(migration).toContain("p_mode not in ('existing','new')");
  expect(migration).toContain("pet_private.member_role(p_pet)");
  expect(migration).toContain("grant execute on function public.checkout_stock_purchase");
  const pet=blankPet("Питомец");
  pet.shopping=[{id:"11111111-1111-4111-8111-111111111111",name:"Шампунь",quantity:"1 шт.",done:false}];
  const html=renderToStaticMarkup(<Stock pet={pet} session={auth} onShop={()=>{}}
    onToggle={()=>{}} onPurchaseDone={async()=>{}} />);
  expect(html).toContain("Шампунь");
 });
});
