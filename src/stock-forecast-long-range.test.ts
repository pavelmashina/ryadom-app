import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import { stockForecast,stockForecastLabel,type StockItem,type StockRule } from "./stock-domain";

const basicRule:StockRule={
 id:"rule",enabled:true,amount:3,unit:"мл",
 frequency:"weekly",interval_count:1,days_of_week:[3],day_of_month:28,
 starts_on:"2026-10-28",ends_on:null,last_processed_on:null,
};
const shampoo:StockItem={
 id:"shampoo",pet_id:"pet",name:"Шампунь",category:"Уход",
 current_quantity:497,reference_quantity:500,display_unit:"мл",unit:"мл",
 low_stock_threshold:0,note:"",notifications_enabled:true,legacy_food:false,
 rules:[basicRule],transactions:[],
};
const from="2026-10-28";

describe("Long-range stock consumption predictions",()=>{
 it("predicts a weekly 3 ml shampoo consumption in 2030, beyond the old 1095-day cutoff",()=>{
  const forecast=stockForecast(shampoo,from);
  expect(forecast).toMatchObject({date:"2030-01-02",occurrences:166,precision:"day"});
  expect(forecast!.days).toBeGreaterThan(1095);
  expect(stockForecastLabel(forecast!,from)).toBe("до 2 янв. 2030");
 });
 it("shows the year only for exact dates beyond the current year",()=>{
  expect(stockForecastLabel({days:54,date:"2026-12-21",occurrences:2,precision:"day"},from))
   .toBe("до 21 дек.");
  expect(stockForecastLabel({days:419,date:"2027-12-21",occurrences:24,precision:"day"},from))
   .toBe("до 21 дек. 2027");
  expect(stockForecastLabel({days:419,date:"2027-12-21",occurrences:2,precision:"month"},from))
   .toBe("до дек. 2027");
 });
 it("does not make up a precise day without a schedule, but can estimate a month from actual historical consumption",()=>{
  const without={...shampoo,rules:[],transactions:[
   {id:"a",type:"manual_use" as const,direction:"out" as const,amount:2,
    applied_amount:2,shortage:0,resulting_quantity:500,occurred_at:"2026-01-01T12:00:00Z",scheduled_for:null,comment:""},
   {id:"b",type:"manual_use" as const,direction:"out" as const,amount:3,
    applied_amount:3,shortage:0,resulting_quantity:497,occurred_at:"2026-02-01T12:00:00Z",scheduled_for:null,comment:""},
  ],current_quantity:40};
  const estimate=stockForecast(without,from);
  expect(estimate?.precision).toBe("month");
  expect(estimate?.date.slice(0,7)).toBe("2027-12");
  expect(stockForecastLabel(estimate!,from)).toBe("до дек. 2027");
  expect(stockForecast({...without,transactions:without.transactions.slice(0,1)},from)).toBeNull();
 });
 it("accounts for multiple weekdays, intervals and a finite end date",()=>{
  const biweekly:StockItem={...shampoo,current_quantity:3,
   rules:[{...basicRule,amount:1,interval_count:2,days_of_week:[1,3,5]}]};
  expect(stockForecast(biweekly,from)?.date).toBe("2026-11-11");
  const finite={...shampoo,rules:[{...basicRule,ends_on:"2027-12-31"}]};
  expect(stockForecast(finite,from)).toBeNull();
 });
 it("handles long-spaced daily recurrence without looping every day",()=>{
  const sparse={...shampoo,current_quantity:10,
   rules:[{...basicRule,frequency:"daily" as const,amount:1,interval_count:366}]};
  expect(stockForecast(sparse,from)?.days).toBe(3660);
 });
 it("respects last day of February for a monthly month-end schedule",()=>{
  const monthEnd:StockItem={...shampoo,current_quantity:1,
   rules:[{...basicRule,frequency:"monthly",amount:1,interval_count:1,
    day_of_month:31,starts_on:"2027-01-31"}]};
  expect(stockForecast(monthEnd,"2027-01-31")?.date).toBe("2027-02-28");
 });
});

describe("Stock UI formats and recurrence fields",()=>{
 const ui=readFileSync(new URL("./Stock.tsx",import.meta.url),"utf8");
 const css=readFileSync(new URL("./stock.css",import.meta.url),"utf8");
 it("uses the same date formatter in stock list and detail",()=>{
  expect(ui).toContain("stockForecastLabel(currentForecast,today())");
  expect(ui).toContain("stockForecastLabel(forecast,today())");
  expect(ui).not.toContain('"Примерно на "+forecast.days');
 });
 it("keeps Repeat every and Period equally sized side by side, including phones",()=>{
  const rules=css.split('/* "Изменить расход": Repeat every and Period share')[1]??"";
  expect(rules).toContain("grid-template-columns: repeat(2, minmax(0,1fr))");
  expect(rules).toContain(".fields > .field :is(input[type=\"number\"],select)");
  expect(rules).toContain("height: var(--button-height-sm)");
  expect(rules).toContain("width: 100%");
  expect(rules).toContain("@media (max-width: 420px)");
  expect(ui).toContain('allowedFrequencies={["daily","weekly","monthly"]}');
 });
});
