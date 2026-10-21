import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import { activeStockRule, compatibleStockUnits, stockAmount, stockForecast, stockProgress, stockRuleText, stockStatus, stockUnitBase, stockUnitFactor, type StockItem, type StockRule } from "./stock-domain";
const css=readFileSync(new URL("./stock.css",import.meta.url),"utf8");
const ddl=readFileSync(new URL("../supabase/migrations/20261021194000_stock_ledger_and_consumption.sql",import.meta.url),"utf8");
const rule:StockRule={id:"r",enabled:true,amount:150,unit:"г",frequency:"daily",interval_count:1,
 days_of_week:[1,2,3,4,5,6,7],day_of_month:21,starts_on:"2026-10-21",ends_on:null,last_processed_on:null};
const food:StockItem={id:"a",pet_id:"p",name:"Корм",category:"Корм",current_quantity:2400,reference_quantity:4000,
 display_unit:"кг",unit:"г",low_stock_threshold:500,note:"",notifications_enabled:true,legacy_food:true,
 rules:[rule],transactions:[]};
describe("Stock domain and scheduled consumption",()=>{
 it("converts compatible units without mixing dimensions",()=>{
  expect(stockUnitBase("кг")).toBe("г");expect(stockUnitBase("л")).toBe("мл");
  expect(stockUnitFactor("л")).toBe(1000);
  expect(compatibleStockUnits("кг")).toEqual(["г","кг"]);
  expect(compatibleStockUnits("таблетки")).toEqual(["таблетки"]);
  expect(stockAmount(2400,"кг")).toBe("2,4");
 });
 it("calculates real future recurrence rather than dividing by an average",()=>{
  expect(stockForecast(food,"2026-10-21")).toMatchObject({days:16,date:"2026-11-06"});
  const spaced={...food,current_quantity:3,rules:[{...rule,amount:1,unit:"таблетки",frequency:"weekly" as const,
   interval_count:2,days_of_week:[1,3,5]}],display_unit:"таблетки" as const,unit:"таблетки"};
  expect(stockForecast(spaced,"2026-10-21")).toMatchObject({date:"2026-11-06"});
  expect(stockRuleText(food.rules[0])).toContain("150 г");
 });
 it("reports low and depleted stock and bounds progress",()=>{
  expect(stockStatus(food)).toBe("normal");
  expect(stockStatus({...food,current_quantity:500})).toBe("low");
  expect(stockStatus({...food,current_quantity:0})).toBe("empty");
  expect(stockProgress(food)).toBe(60);
  expect(stockProgress({...food,current_quantity:5000})).toBe(100);
  expect(activeStockRule({...food,rules:[{...rule,enabled:false}]})).toBeNull();
 });
 it("enforces DB-side inventory invariants, unique occurrence, membership and hourly cron",()=>{
  for(const name of ["stock_items","stock_consumption_rules","stock_transactions"]) {
   expect(ddl).toContain("create table if not exists public."+name);
   expect(ddl).toContain("alter table public."+name+" enable row level security");
  }
  expect(ddl).toContain("unique(consumption_rule_id,scheduled_for)");
  expect(ddl).toContain("on conflict(consumption_rule_id,scheduled_for) do nothing");
  expect(ddl).toContain("least(item.current_quantity,r.amount)");
  expect(ddl).toContain("pet_private.member_role(p_pet)");
  expect(ddl).toContain("grant select on public.stock_items, public.stock_consumption_rules, public.stock_transactions to authenticated");
  expect(ddl).toContain("cron.schedule('pet-stock-consumption-hourly'");
  expect(ddl).toContain("'Начальный остаток при миграции'");
 });
 it("uses shared compact typography and 12px title/16px section gaps",()=>{
  expect(css).toContain("--stock-heading-gap: var(--space-compact-4)");
  expect(css).toContain("--stock-section-gap: var(--space-compact-5)");
  for(const size of ["xl","lg","md","sm","xs"])expect(css).toContain("var(--font-size-"+size+")");
  expect(css).toContain(".stock-list {display:grid");
  expect(css).not.toContain("carousel");
 });
});
